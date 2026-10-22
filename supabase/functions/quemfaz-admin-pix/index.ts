import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// QuemFaz 11.57 — o admin gera, pelo painel, o Pix de um plano para um profissional que já tem conta.
// Vira uma recarga pendente do plano (igual à da Carteira): quando o Pix é pago, a conferência de
// minuto em minuto (quemfaz-efi-pix-sync) aprova e o plano ativa sozinho.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EFI_CLIENT_ID = Deno.env.get("EFI_CLIENT_ID") || "";
const EFI_CLIENT_SECRET = Deno.env.get("EFI_CLIENT_SECRET") || "";
const EFI_CERT_P12 = Deno.env.get("EFI_CERT_P12_PROD_BASE64") || "";
const EFI_PIX_KEY = Deno.env.get("EFI_PIX_KEY") || "";
const EFI_SANDBOX = (Deno.env.get("EFI_SANDBOX") || "false").toLowerCase() === "true";
const EFI_PIX_BASE = EFI_SANDBOX ? "https://pix-h.api.efipay.com.br" : "https://pix.api.efipay.com.br";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: cors }); }

function p12ToPem(base64: string) {
  const der = forge.util.decode64(base64.replace(/\s+/g, ""));
  const asn1 = forge.asn1.fromDer(der);
  let p12: any = null, last: any = null;
  for (const password of ["", undefined as any]) {
    try { p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password); break; } catch (e) { last = e; }
  }
  if (!p12) throw last || new Error("p12_parse_failed");
  const co = forge.pki.oids.certBag, so = forge.pki.oids.pkcs8ShroudedKeyBag, ko = forge.pki.oids.keyBag;
  const cs = p12.getBags({ bagType: co })[co] || [], ks = p12.getBags({ bagType: so })[so] || [], kp = p12.getBags({ bagType: ko })[ko] || [];
  const c = cs.find((b: any) => b.cert) || cs[0];
  const k = ks.find((b: any) => b.key) || kp.find((b: any) => b.key) || ks[0] || kp[0];
  if (!c?.cert || !k?.key) throw new Error("p12_key_or_cert_missing");
  return { cert: forge.pki.certificateToPem(c.cert), key: forge.pki.privateKeyToPem(k.key) };
}

async function criarPix(recargaId: string, valorCentavos: number, nomePlano: string) {
  if (!EFI_CERT_P12 || !EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !EFI_PIX_KEY) throw new Error("efi_pix_not_configured");
  const pem = p12ToPem(EFI_CERT_P12);
  const client = Deno.createHttpClient({ cert: pem.cert, key: pem.key });
  try {
    const tr = await fetch(EFI_PIX_BASE + "/oauth/token", {
      method: "POST", client,
      headers: { "Authorization": "Basic " + btoa(EFI_CLIENT_ID + ":" + EFI_CLIENT_SECRET), "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials" }),
    });
    const td = await tr.json().catch(() => ({}));
    if (!tr.ok || !td.access_token) throw new Error("efi_pix_auth_failed");
    const token = String(td.access_token);
    const txid = recargaId.replace(/-/g, "").slice(0, 35);
    const r = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(txid), {
      method: "PUT", client,
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        calendario: { expiracao: 86400 },
        valor: { original: (valorCentavos / 100).toFixed(2) },
        chave: EFI_PIX_KEY,
        solicitacaoPagador: "Plano " + nomePlano + " no QuemFaz",
        infoAdicionais: [{ nome: "QuemFaz", valor: "qf:recarga:" + recargaId }],
      }),
    });
    const cob = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("efi_pix_charge_failed");
    const locId = cob?.loc?.id;
    if (!locId) throw new Error("efi_pix_location_missing");
    const qrR = await fetch(EFI_PIX_BASE + "/v2/loc/" + encodeURIComponent(String(locId)) + "/qrcode", {
      method: "GET", client, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    });
    const qr = await qrR.json().catch(() => ({}));
    if (!qrR.ok || !qr?.qrcode) throw new Error("efi_pix_qrcode_failed");
    return {
      txid,
      checkoutUrl: qr?.linkVisualizacao ? String(qr.linkVisualizacao) : null,
      pixCopyPaste: String(qr.qrcode),
      qrImage: qr?.imagemQrcode ? String(qr.imagemQrcode) : null,
    };
  } finally { client.close(); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = token ? await admin.auth.getUser(token) : { data: { user: null } } as any;
  if (!u?.user) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: isAdmin } = await admin.from("qf_admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
  if (!isAdmin) return json({ ok: false, error: "forbidden" }, 403);

  const body: any = await req.json().catch(() => ({}));
  const profissionalId = String(body.profissional_id || "");
  const plano = String(body.plano || "");
  if (!/^[0-9a-f-]{36}$/i.test(profissionalId) || !plano) return json({ ok: false, error: "invalid_request" }, 400);

  // Cria a recarga pendente do plano (preço do catálogo). Só o servidor chama esta função do banco.
  const novo = await admin.rpc("qf_admin_recarga_plano_criar", { p_admin: u.user.id, p_profissional: profissionalId, p_plano: plano });
  if (novo.error || !novo.data?.ok) return json({ ok: false, error: novo.data?.reason || "Não foi possível criar a cobrança." });
  const rec = novo.data;

  try {
    const pix = await criarPix(String(rec.recarga_id), Number(rec.valor_centavos), String(rec.nome_plano));
    const upd = await admin.from("qf_recargas").update({ provedor: "efi", provedor_id: pix.txid, checkout_url: pix.checkoutUrl }).eq("id", rec.recarga_id);
    if (upd.error) throw new Error("db_update_failed");
    return json({
      ok: true, recarga_id: rec.recarga_id, plano: rec.plano, nome_plano: rec.nome_plano, valor_centavos: rec.valor_centavos,
      pix_copy_paste: pix.pixCopyPaste, qr_image: pix.qrImage, checkout_url: pix.checkoutUrl,
    });
  } catch (e) {
    console.warn("QF_ADMIN_PIX_FALHOU", String((e as Error).message || e));
    await admin.from("qf_recargas").update({ status: "cancelado" }).eq("id", rec.recarga_id).eq("status", "pendente");
    return json({ ok: false, error: "A Efí não gerou o Pix agora. Tente de novo em instantes." });
  }
});
