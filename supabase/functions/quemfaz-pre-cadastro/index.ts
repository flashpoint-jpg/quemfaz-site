import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import forge from "npm:node-forge@1.3.1";

// QuemFaz 11.50 — plano pago ANTES de criar a conta do profissional.
// "criar": gera a cobrança na Efí (Pix ou link de cartão) para quem ainda não tem conta.
// "status": consulta a Efí e diz se o pagamento foi confirmado.
// A conta só é criada pelo app depois do "aprovado"; o plano entra por qf_resgatar_pre_cadastro.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EFI_CLIENT_ID = Deno.env.get("EFI_CLIENT_ID") || "";
const EFI_CLIENT_SECRET = Deno.env.get("EFI_CLIENT_SECRET") || "";
const EFI_CERT_P12 = Deno.env.get("EFI_CERT_P12_PROD_BASE64") || "";
const EFI_PIX_KEY = Deno.env.get("EFI_PIX_KEY") || "";
const EFI_SANDBOX = (Deno.env.get("EFI_SANDBOX") || "false").toLowerCase() === "true";
const EFI_PIX_BASE = EFI_SANDBOX ? "https://pix-h.api.efipay.com.br" : "https://pix.api.efipay.com.br";
const EFI_CHARGE_BASE = EFI_SANDBOX ? "https://cobrancas-h.api.efipay.com.br" : "https://cobrancas.api.efipay.com.br";
const TABLE = "qf_pre_cadastro_pagamentos";

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
async function chargeToken() {
  const r = await fetch(EFI_CHARGE_BASE + "/v1/authorize", {
    method: "POST",
    headers: { "Authorization": "Basic " + btoa(EFI_CLIENT_ID + ":" + EFI_CLIENT_SECRET), "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error("efi_charge_auth_failed");
  return String(d.access_token);
}
function customId(id: string) { return ("qf_precadastro_" + id).replace(/[^a-zA-Z0-9_-]/g, "_"); }

async function criarPix(row: any, nomePlano: string) {
  const client = pixClient();
  try {
    const token = await pixToken(client);
    const txid = String(row.id).replace(/-/g, "").slice(0, 35);
    const r = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(txid), {
      method: "PUT", client,
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        calendario: { expiracao: 86400 },
        valor: { original: (Number(row.valor_centavos) / 100).toFixed(2) },
        chave: EFI_PIX_KEY,
        solicitacaoPagador: "Plano " + nomePlano + " no QuemFaz",
        infoAdicionais: [{ nome: "QuemFaz", valor: "qf:precadastro:" + row.id }],
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
      provedorId: txid,
      checkoutUrl: qr?.linkVisualizacao ? String(qr.linkVisualizacao) : null,
      pixCopyPaste: String(qr.qrcode),
      qrImage: qr?.imagemQrcode ? String(qr.imagemQrcode) : null,
    };
  } finally { client.close(); }
}

async function criarLinkCartao(row: any, nomePlano: string) {
  const token = await chargeToken();
  const payload: any = {
    items: [{ name: "Plano " + nomePlano + " QuemFaz", value: Number(row.valor_centavos), amount: 1 }],
    metadata: { custom_id: customId(row.id), notification_url: SUPABASE_URL + "/functions/v1/quemfaz-efi-notification" },
    settings: {
      payment_method: "credit_card",
      expire_at: new Date(Date.now() + 259200000).toISOString().slice(0, 10),
      request_delivery_address: false,
      message: "Plano " + nomePlano + " no QuemFaz",
    },
    customer: { email: row.email },
  };
  const resp = await fetch(EFI_CHARGE_BASE + "/v1/charge/one-step/link", {
    method: "POST",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.data?.payment_url || !data?.data?.charge_id) {
    console.warn("QF_PRECADASTRO_CARTAO_FALHOU", JSON.stringify({ status: resp.status, code: data?.code || data?.error || null, message: data?.message || data?.error_description || null }));
    throw new Error("efi_charge_failed");
  }
  return { provedorId: String(data.data.charge_id), checkoutUrl: String(data.data.payment_url), pixCopyPaste: null, qrImage: null };
}

// Consulta a Efí. Só devolve "aprovado" quando o valor e a identificação batem.
async function consultar(row: any): Promise<string> {
  const pid = String(row.provedor_id || "");
  if (!pid) return "pendente";
  if (row.metodo === "pix") {
    const client = pixClient();
    try {
      const token = await pixToken(client);
      const r = await fetch(EFI_PIX_BASE + "/v2/cob/" + encodeURIComponent(pid), {
        method: "GET", client, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      });
      if (!r.ok) return "pendente";
      const cob = await r.json().catch(() => ({}));
      const st = String(cob?.status || "").toUpperCase();
      if (st === "CONCLUIDA") {
        const esperado = Number(row.valor_centavos);
        const original = Math.round(Number(cob?.valor?.original || 0) * 100);
        const pago = Array.isArray(cob?.pix) ? Math.round(cob.pix.reduce((s: number, p: any) => s + Number(p?.valor || 0), 0) * 100) : 0;
        return esperado === original && pago >= esperado ? "aprovado" : "pendente";
      }
      if (st.startsWith("REMOVIDA")) return "cancelado";
      return "pendente";
    } finally { client.close(); }
  }
  const token = await chargeToken();
  const r = await fetch(EFI_CHARGE_BASE + "/v1/charge/" + encodeURIComponent(pid), {
    method: "GET", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
  });
  const d: any = await r.json().catch(() => ({}));
  const cob = d?.data;
  if (!r.ok || !cob) return "pendente";
  const st = String(cob.status || "").toLowerCase();
  if (["paid", "approved", "settled"].includes(st)) {
    const confere = Number(cob.total || 0) === Number(row.valor_centavos) && String(cob.custom_id || "") === customId(row.id);
    return confere ? "aprovado" : "pendente";
  }
  if (["unpaid", "canceled", "refunded"].includes(st)) return "cancelado";
  if (st === "expired") return "expirado";
  return "pendente";
}

function segredoNovo() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const body: any = await req.json().catch(() => ({}));
  const acao = String(body.acao || "");

  if (acao === "criar") {
    const plano = String(body.plano || "");
    const metodo = String(body.metodo || "pix");
    const email = String(body.email || "").trim().toLowerCase();
    const nome = String(body.nome || "").trim().slice(0, 160);
    const telefone = String(body.telefone || "").replace(/\D/g, "").slice(0, 13);
    if (!["pix", "cartao"].includes(metodo)) return json({ ok: false, error: "metodo_invalido" }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ ok: false, error: "email_invalido" }, 400);

    const cat = await admin.from("qf_planos_catalogo").select("plano,nome,preco_centavos,ativo").eq("plano", plano).maybeSingle();
    if (cat.error || !cat.data || !cat.data.ativo) return json({ ok: false, error: "plano_invalido" }, 400);

    const livre = await admin.rpc("qf_pre_cadastro_email_livre", { p_email: email });
    if (livre.error) return json({ ok: false, error: "falha_interna" }, 500);
    if (livre.data !== true) return json({ ok: false, error: "email_em_uso" });

    // Freio contra abuso: cada tentativa abre uma cobrança na Efí.
    const umaHora = new Date(Date.now() - 3600000).toISOString();
    const dezMin = new Date(Date.now() - 600000).toISOString();
    const porEmail = await admin.from(TABLE).select("id", { count: "exact", head: true }).eq("email", email).gte("criado_em", umaHora);
    const geral = await admin.from(TABLE).select("id", { count: "exact", head: true }).gte("criado_em", dezMin);
    if ((porEmail.count || 0) >= 8 || (geral.count || 0) >= 60) return json({ ok: false, error: "muitas_tentativas" });

    const segredo = segredoNovo();
    const ins = await admin.from(TABLE).insert({
      segredo, email, nome: nome || null, telefone: telefone || null,
      plano: cat.data.plano, valor_centavos: cat.data.preco_centavos, metodo,
    }).select("id,email,valor_centavos,metodo").single();
    if (ins.error || !ins.data) return json({ ok: false, error: "falha_interna" }, 500);
    const row = ins.data;

    try {
      const cob = metodo === "pix" ? await criarPix(row, cat.data.nome) : await criarLinkCartao(row, cat.data.nome);
      const upd = await admin.from(TABLE).update({ provedor: "efi", provedor_id: cob.provedorId, checkout_url: cob.checkoutUrl }).eq("id", row.id);
      if (upd.error) return json({ ok: false, error: "falha_interna" }, 500);
      return json({
        ok: true, id: row.id, segredo, status: "pendente", plano: cat.data.plano, nome_plano: cat.data.nome,
        valor_centavos: row.valor_centavos, metodo,
        pix_copy_paste: cob.pixCopyPaste, qr_image: cob.qrImage, checkout_url: cob.checkoutUrl,
      });
    } catch (e) {
      console.warn("QF_PRECADASTRO_COBRANCA_FALHOU", String((e as Error).message || e));
      await admin.from(TABLE).update({ status: "cancelado" }).eq("id", row.id);
      return json({ ok: false, error: "cobranca_indisponivel", metodo });
    }
  }

  if (acao === "status") {
    const id = String(body.id || ""), segredo = String(body.segredo || "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || segredo.length < 20) return json({ ok: false, error: "invalid_request" }, 400);
    const q = await admin.from(TABLE).select("id,segredo,valor_centavos,metodo,status,provedor_id,profissional_id,plano").eq("id", id).maybeSingle();
    if (q.error || !q.data || q.data.segredo !== segredo) return json({ ok: false, error: "nao_encontrado" }, 404);
    let status = String(q.data.status);
    if (status === "pendente") {
      try {
        const novo = await consultar(q.data);
        if (novo !== "pendente") {
          const patch: any = { status: novo };
          if (novo === "aprovado") patch.aprovado_em = new Date().toISOString();
          const upd = await admin.from(TABLE).update(patch).eq("id", id).eq("status", "pendente");
          if (!upd.error) status = novo;
        }
      } catch (e) {
        console.warn("QF_PRECADASTRO_CONSULTA_FALHOU", String((e as Error).message || e));
      }
    }
    return json({ ok: true, status, plano: q.data.plano, resgatado: !!q.data.profissional_id });
  }

  return json({ ok: false, error: "invalid_request" }, 400);
});
