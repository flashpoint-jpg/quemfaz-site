import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// QuemFaz 11.73 — propaganda QuemFaz Premium solicitada SEM conta.
// "criar": grava a solicitação (aguardando Pix e aprovação do admin) e gera o Pix na Efí.
// "status": diz se o Pix já foi confirmado e se a propaganda já foi aprovada.
// A confirmação com a página fechada continua na quemfaz-efi-pix-sync (qf_anuncio_pagamentos).

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
function pixClient() {
  if (!EFI_CERT_P12) throw new Error("efi_certificate_not_configured");
  const pem = p12ToPem(EFI_CERT_P12);
  return Deno.createHttpClient({ cert: pem.cert, key: pem.key });
}
async function pixToken(client: Deno.HttpClient) {
  if (!EFI_CLIENT_ID || !EFI_CLIENT_SECRET || !EFI_PIX_KEY) throw new Error("efi_pix_not_configured");
  const r = await fetch(EFI_PIX_BASE + "/oauth/token", {
    method: "POST", client,
    headers: { "Authorization": "Basic " + btoa(EFI_CLIENT_ID + ":" + EFI_CLIENT_SECRET), "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("efi_pix_auth_failed");
  return String(d.access_token);
}

// Mesmo formato da quemfaz-efi-checkout: txid = id do pagamento sem os traços.
async function criarPix(pagamentoId: string, valorCentavos: number) {
  const client = pixClient();
  try {
    const token = await pixToken(client);
    const txid = pagamentoId.replace(/-/g, "").slice(0, 35);
    const r = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(txid), {
      method: "PUT", client,
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        calendario: { expiracao: 86400 },
        valor: { original: (valorCentavos / 100).toFixed(2) },
        chave: EFI_PIX_KEY,
        solicitacaoPagador: "Propaganda QuemFaz Premium",
        infoAdicionais: [{ nome: "QuemFaz", valor: "qf:anuncio:" + pagamentoId }],
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

// Só devolve "aprovado" quando o valor pago bate com o da propaganda.
async function consultarPix(txid: string, valorCentavos: number): Promise<string> {
  if (!/^[A-Za-z0-9]{26,35}$/.test(txid)) return "pendente";
  const client = pixClient();
  try {
    const token = await pixToken(client);
    const r = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(txid), {
      method: "GET", client, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    });
    if (!r.ok) return "pendente";
    const cob = await r.json().catch(() => ({}));
    if (String(cob?.status || "").toUpperCase() !== "CONCLUIDA") return "pendente";
    const original = Math.round(Number(cob?.valor?.original || 0) * 100);
    const pago = Array.isArray(cob?.pix) ? Math.round(cob.pix.reduce((s: number, p: any) => s + Number(p?.valor || 0), 0) * 100) : 0;
    return valorCentavos === original && pago >= valorCentavos ? "aprovado" : "pendente";
  } finally { client.close(); }
}

function segredoNovo() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function telefone(v: unknown) {
  let n = String(v || "").replace(/\D/g, "");
  if (n.startsWith("55") && n.length >= 12) n = n.slice(2);
  return n.length === 10 || n.length === 11 ? n : "";
}
// Destino do clique: WhatsApp (número), ligação ("tel:") ou site ("https://").
function destino(tipo: string, valor: string): { whatsapp: string | null; url: string | null } | null {
  if (tipo === "whatsapp" || tipo === "ligacao") {
    const n = telefone(valor);
    if (!n) return null;
    return tipo === "whatsapp" ? { whatsapp: n, url: null } : { whatsapp: null, url: "tel:+55" + n };
  }
  if (tipo === "site") {
    let u = String(valor || "").trim();
    if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
    if (!/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(u) || u.length > 300) return null;
    return { whatsapp: null, url: u };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const body: any = await req.json().catch(() => ({}));
  const acao = String(body.acao || "");

  if (acao === "criar") {
    const empresa = String(body.empresa || "").trim();
    const chamada = String(body.chamada || "").trim();
    const imagem = String(body.imagem || "");
    const nome = String(body.nome || "").trim().slice(0, 80);
    const zap = telefone(body.whatsapp);
    const dest = destino(String(body.destino_tipo || ""), String(body.destino_valor || ""));
    if (empresa.length < 2 || empresa.length > 40) return json({ ok: false, error: "empresa_invalida" });
    if (chamada.length < 4 || chamada.length > 60) return json({ ok: false, error: "frase_invalida" });
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(imagem) || imagem.length < 200 || imagem.length > 700000) return json({ ok: false, error: "imagem_invalida" });
    if (!dest) return json({ ok: false, error: "destino_invalido" });
    if (nome.length < 2) return json({ ok: false, error: "nome_invalido" });
    if (!zap) return json({ ok: false, error: "whatsapp_invalido" });

    const segredo = segredoNovo();
    const cri = await admin.rpc("qf_anuncio_premium_criar", {
      p_empresa: empresa, p_chamada: chamada, p_imagem_data: imagem,
      p_destino_tipo: String(body.destino_tipo || ""), p_destino_valor: dest.whatsapp || dest.url || "",
      p_nome: nome, p_whatsapp: zap, p_segredo: segredo,
    });
    if (cri.error || !cri.data) { console.warn("QF_ANUNCIO_PREMIUM_CRIAR", cri.error?.message); return json({ ok: false, error: "falha_interna" }, 500); }
    if (!cri.data.ok) return json({ ok: false, error: String(cri.data.reason || "falha_interna") });
    const anuncioId = String(cri.data.anuncio_id), pagamentoId = String(cri.data.pagamento_id), valor = Number(cri.data.valor_centavos);
    const desfazer = async () => { await admin.rpc("qf_anuncio_premium_desfazer", { p_id: anuncioId }); };

    try {
      const pix = await criarPix(pagamentoId, valor);
      const upd = await admin.from("qf_anuncio_pagamentos").update({ provedor: "efi", provedor_id: pix.txid, checkout_url: pix.checkoutUrl }).eq("id", pagamentoId);
      if (upd.error) { await desfazer(); return json({ ok: false, error: "falha_interna" }, 500); }
      return json({
        ok: true, id: anuncioId, segredo, valor_centavos: valor, dias: 30,
        pix_copy_paste: pix.pixCopyPaste, qr_image: pix.qrImage, checkout_url: pix.checkoutUrl,
      });
    } catch (e) {
      console.warn("QF_ANUNCIO_PREMIUM_PIX_FALHOU", String((e as Error).message || e));
      await desfazer();
      return json({ ok: false, error: "cobranca_indisponivel" });
    }
  }

  if (acao === "status") {
    const id = String(body.id || ""), segredo = String(body.segredo || "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || segredo.length < 20) return json({ ok: false, error: "invalid_request" }, 400);
    const q = await admin.rpc("qf_anuncio_premium_status", { p_id: id, p_segredo: segredo });
    if (q.error || !q.data) return json({ ok: false, error: "nao_encontrado" }, 404);
    const d: any = q.data;
    let pagamento = String(d.pagamento || "pendente");
    if (pagamento === "pendente" && d.pagamento_id && d.provedor_id) {
      try {
        const novo = await consultarPix(String(d.provedor_id), Number(d.valor_centavos));
        if (novo === "aprovado") {
          const upd = await admin.from("qf_anuncio_pagamentos").update({ status: "aprovado" }).eq("id", d.pagamento_id).eq("status", "pendente");
          if (!upd.error) pagamento = "aprovado";
        }
      } catch (e) {
        console.warn("QF_ANUNCIO_PREMIUM_CONSULTA_FALHOU", String((e as Error).message || e));
      }
    }
    return json({ ok: true, pagamento, status: String(d.status || "pendente"), fim_em: d.fim_em || null });
  }

  return json({ ok: false, error: "invalid_request" }, 400);
});
