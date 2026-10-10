import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import webpush from "npm:web-push@3.6.7";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

// QuemFaz — avisos para o admin (push no celular/navegador do dono).
// Chamado só pelo banco (private.qf_admin_push_interno), com a senha interna do Vault.
// Dinheiro: precadastro_started, precadastro_approved, recharge_approved, priority_payment_approved.
// Movimento: new_profile, call_accepted, quote_sent, call_status, support_message.
// Função separada da quemfaz-push de propósito: nada aqui mexe no aviso de chamado dos profissionais.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = "BHKGLb0G49jDzmd6zoWU4HYzk8gAF3ilPMBx_-O3SMy1vPELJJZ6euC2XkSRcy8mF9MMYDKY9Lf7039nokcCHqw";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function ensureVapid(): Promise<boolean> {
  try {
    let priv = (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
    if (!priv) {
      const { data, error } = await admin.rpc("qf_push_vapid_private");
      if (error) console.error("VAPID privada (Vault)", error.message);
      priv = String(data || "").trim();
    }
    if (!priv) return false;
    webpush.setVapidDetails("mailto:suporte@quemfaz.app", VAPID_PUBLIC, priv);
    return true;
  } catch (err) {
    console.error("VAPID", err);
    return false;
  }
}

const FCM_PREFIX = "fcm:";
let fcmAccount: any = null;
try {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT") || "";
  if (raw.trim()) fcmAccount = JSON.parse(raw);
} catch (err) {
  console.error("FCM_SERVICE_ACCOUNT inválido", err);
}

async function fcmAccessToken(): Promise<string | null> {
  if (!fcmAccount) return null;
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(String(fcmAccount.private_key || ""), "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(fcmAccount.client_email)
    .setSubject(fcmAccount.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok || !out.access_token) { console.error("FCM token", resp.status); return null; }
  return String(out.access_token);
}

// Mesmo formato de aviso comum (sem toque de chamado) que a quemfaz-push usa.
async function sendFcm(access: string, token: string, payload: any, soDados: boolean): Promise<"ok" | "gone" | "error"> {
  const title = String(payload.title || "QuemFaz");
  const body = String(payload.body || "");
  const tag = String(payload.tag || "quemfaz");
  const channel = "quemfaz_avisos";
  const message: any = {
    token,
    data: { title, body, url: String(payload.url || "/#/"), tag, strong: "0", channel, alerta: "toque", grouped: "0", count: "0", tipo: "chamado" },
    android: { priority: "HIGH", ttl: "3600s" },
  };
  if (!soDados) {
    message.notification = { title, body };
    message.android.notification = {
      channel_id: channel, tag, notification_priority: "PRIORITY_HIGH", visibility: "PUBLIC",
      default_vibrate_timings: true, default_light_settings: true,
    };
  }
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmAccount.project_id}/messages:send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + access },
    body: JSON.stringify({ message }),
  });
  if (resp.ok) return "ok";
  const txt = await resp.text().catch(() => "");
  if (resp.status === 404 || /UNREGISTERED|registration-token-not-registered/i.test(txt)) return "gone";
  console.error("FCM send", resp.status, txt.slice(0, 300));
  return "error";
}

async function sendToAdmins(payload: any) {
  const { data: admins } = await admin.from("qf_admins").select("user_id");
  return sendToUsers((admins || []).map((a: any) => String(a.user_id)).filter(Boolean), payload);
}

async function sendToUsers(ids: string[], payload: any) {
  if (!ids.length) return { sent: 0, total: 0 };
  const { data: subs, error } = await admin
    .from("qf_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_key,user_agent")
    .in("user_id", ids)
    .eq("ativo", true);
  if (error) throw error;
  const webOk = await ensureVapid();
  let access: string | null = null;
  let sent = 0;
  for (const s of subs || []) {
    const endpoint = String(s.endpoint || "");
    try {
      if (endpoint.startsWith(FCM_PREFIX)) {
        if (!fcmAccount) continue;
        if (!access) access = await fcmAccessToken();
        if (!access) continue;
        const m = /^apk android;v=(\d+)/.exec(String(s.user_agent || ""));
        const r = await sendFcm(access, endpoint.slice(FCM_PREFIX.length), payload, !!m && Number(m[1]) >= 12);
        if (r === "ok") sent++;
        if (r === "gone") await admin.from("qf_push_subscriptions").update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", s.id);
        continue;
      }
      if (!webOk) continue;
      await webpush.sendNotification(
        { endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "high" },
      );
      sent++;
    } catch (err: any) {
      const code = Number(err?.statusCode || err?.status || 0);
      if (code === 404 || code === 410 || code === 401 || code === 403) {
        await admin.from("qf_push_subscriptions").update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", s.id);
      } else {
        console.error("push admin", code || err);
      }
    }
  }
  return { sent, total: (subs || []).length };
}

function brl(c: unknown) { return "R$ " + (Number(c || 0) / 100).toFixed(2).replace(".", ","); }
function metodoNome(m: unknown) { const s = String(m || ""); return s === "pix" ? "Pix" : s === "cartao" ? "cartão" : s === "boleto" ? "boleto" : (s || "pagamento"); }
function curto(v: unknown, n = 120) { const s = String(v || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }
function lugar(...p: unknown[]) { return p.map((x) => String(x || "").trim()).filter(Boolean).join(" · "); }
async function nomePlano(plano: unknown) {
  const p = String(plano || "");
  if (!p) return "";
  const { data } = await admin.from("qf_planos_catalogo").select("nome").eq("plano", p).maybeSingle();
  return String(data?.nome || p);
}
async function nomeDe(userId: unknown, padrao: string) {
  if (!userId) return padrao;
  const { data } = await admin.from("qf_profiles").select("nome").eq("id", userId).maybeSingle();
  return String(data?.nome || padrao);
}
async function chamado(id: unknown) {
  if (!id) return null;
  const { data } = await admin.from("qf_chamados").select("id,titulo,bairro,cidade,uf,status").eq("id", id).maybeSingle();
  return data || null;
}

const STATUS_CHAMADO: Record<string, string> = {
  aberto: "aberto",
  em_negociacao: "em negociação",
  em_andamento: "em andamento",
  concluido: "concluído",
  cancelado: "cancelado",
  expirado: "expirado",
  fechado: "fechado",
};

async function montar(event: string, id: string): Promise<any | null> {
  if (event === "precadastro_started" || event === "precadastro_approved") {
    const { data: r } = await admin.from("qf_pre_cadastro_pagamentos")
      .select("id,nome,email,telefone,plano,valor_centavos,metodo,status,profissional_id").eq("id", id).maybeSingle();
    if (!r) return null;
    const quem = String(r.nome || r.email || "Profissional");
    const plano = await nomePlano(r.plano);
    const contato = r.telefone ? " · WhatsApp " + r.telefone : (r.email ? " · " + r.email : "");
    if (event === "precadastro_started") {
      return {
        title: "Novo cadastro escolhendo plano: " + quem,
        body: "Plano " + plano + " · " + brl(r.valor_centavos) + " no " + metodoNome(r.metodo) + " — aguardando pagamento" + contato,
        url: "/admin.html", tag: "qf-precad-inicio-" + r.id,
      };
    }
    if (r.status !== "aprovado") return null;
    return {
      title: "💰 Plano pago: " + quem,
      body: "Plano " + plano + " · " + brl(r.valor_centavos) + " no " + metodoNome(r.metodo) + (r.profissional_id ? "" : " — falta ele criar a conta") + contato,
      url: "/admin.html", tag: "qf-precad-pago-" + r.id,
    };
  }
  if (event === "recharge_approved") {
    const { data: r } = await admin.from("qf_recargas").select("id,profissional_id,valor_centavos,metodo,plano,status").eq("id", id).maybeSingle();
    if (!r || r.status !== "aprovado") return null;
    const quem = await nomeDe(r.profissional_id, "Profissional");
    const { data: pre } = await admin.from("qf_pre_cadastro_pagamentos").select("id").eq("recarga_id", r.id).limit(1).maybeSingle();
    const plano = r.plano ? await nomePlano(r.plano) : "";
    if (pre) {
      return {
        title: "✅ Conta criada com plano: " + quem,
        body: "Plano " + plano + " · " + brl(r.valor_centavos) + " — pagamento já confirmado, plano ativado.",
        url: "/admin.html", tag: "qf-precad-conta-" + r.id,
      };
    }
    return {
      title: (plano ? "💰 Plano pago: " : "💰 Recarga paga: ") + quem,
      body: (plano ? "Plano " + plano + " · " : "") + brl(r.valor_centavos) + " no " + metodoNome(r.metodo),
      url: "/admin.html", tag: "qf-recarga-" + r.id,
    };
  }
  if (event === "priority_payment_approved") {
    const { data: r } = await admin.from("qf_prioridade_pagamentos").select("id,chamado_id,valor_centavos,metodo,status").eq("id", id).maybeSingle();
    if (!r || r.status !== "aprovado") return null;
    const c = await chamado(r.chamado_id);
    return {
      title: "💰 Prioridade paga pelo cliente",
      body: lugar(brl(r.valor_centavos) + " no " + metodoNome(r.metodo), c?.titulo, c?.cidade),
      url: "/admin.html", tag: "qf-prioridade-" + r.id,
    };
  }
  if (event === "new_profile") {
    const { data: p } = await admin.from("qf_profiles").select("id,tipo,nome,cidade,uf,whatsapp,telefone").eq("id", id).maybeSingle();
    if (!p) return null;
    const pro = String(p.tipo || "") === "profissional";
    const fone = p.whatsapp || p.telefone;
    return {
      title: (pro ? "Novo profissional: " : "Novo cliente: ") + String(p.nome || "sem nome"),
      body: lugar([p.cidade, p.uf].filter(Boolean).join("/"), fone ? "WhatsApp " + fone : "") || "Cadastro feito agora.",
      url: "/admin.html", tag: "qf-perfil-" + p.id,
    };
  }
  if (event === "call_accepted") {
    const { data: d } = await admin.from("qf_desbloqueios").select("id,chamado_id,profissional_id,valor_centavos,origem,plano_id").eq("id", id).maybeSingle();
    if (!d) return null;
    const c = await chamado(d.chamado_id);
    const quem = await nomeDe(d.profissional_id, "Profissional");
    const pago = d.plano_id ? "pelo plano" : brl(d.valor_centavos);
    return {
      title: "🔓 Pedido desbloqueado: " + quem,
      body: lugar(c?.titulo || "Serviço", [c?.cidade, c?.uf].filter(Boolean).join("/"), pago),
      url: "/admin.html", tag: "qf-desbloqueio-" + d.id,
    };
  }
  if (event === "quote_sent") {
    const { data: o } = await admin.from("qf_orcamentos").select("id,chamado_id,profissional_id,valor_centavos").eq("id", id).maybeSingle();
    if (!o) return null;
    const c = await chamado(o.chamado_id);
    return {
      title: "Orçamento enviado: " + (await nomeDe(o.profissional_id, "Profissional")),
      body: lugar(c?.titulo || "Serviço", brl(o.valor_centavos)),
      url: "/admin.html", tag: "qf-orcamento-" + o.id,
    };
  }
  if (event === "call_status") {
    const c = await chamado(id);
    if (!c) return null;
    const st = String(c.status || "");
    return {
      title: "Pedido " + (STATUS_CHAMADO[st] || st) + ": " + String(c.titulo || "Serviço"),
      body: lugar(c.bairro, [c.cidade, c.uf].filter(Boolean).join("/")) || "Abra o painel para ver.",
      url: "/admin.html", tag: "qf-status-" + c.id,
    };
  }
  if (event === "support_message") {
    const { data: m } = await admin.from("qf_suporte_mensagens").select("id,atendimento_id,autor_id,autor_tipo,mensagem").eq("id", id).maybeSingle();
    if (!m || String(m.autor_tipo || "") === "admin") return null;
    return {
      title: "💬 Suporte: " + (await nomeDe(m.autor_id, "Usuário")),
      body: curto(m.mensagem) || "Nova mensagem no suporte.",
      url: "/admin.html", tag: "qf-suporte-" + String(m.atendimento_id || m.id),
    };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = String(req.headers.get("x-qf-internal") || "");
  if (secret.length < 32) return json({ error: "unauthorized" }, 401);
  const { data: okSecret } = await admin.rpc("qf_push_internal_ok", { p_segredo: secret });
  if (okSecret !== true) return json({ error: "unauthorized" }, 401);

  const body: any = await req.json().catch(() => ({}));
  // Recado do admin para usuários específicos (ex.: "seu Pix ficou pendente"). Aviso comum, sem toque de chamado.
  if (String(body.action || "") === "user_notice") {
    const ids = (Array.isArray(body.user_ids) ? body.user_ids : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
    const title = String(body.title || "").trim().slice(0, 120);
    const texto = String(body.body || "").trim().slice(0, 400);
    if (!ids.length || !title || !texto) return json({ error: "invalid_notice" }, 400);
    try {
      const porUsuario: Record<string, unknown> = {};
      for (const uid of ids) {
        porUsuario[uid] = await sendToUsers([uid], { title, body: texto, url: String(body.url || "/#/"), tag: String(body.tag || "qf-recado") });
      }
      return json({ ok: true, recado: porUsuario });
    } catch (err) {
      console.error("recado usuario", err);
      return json({ error: "user_notice_failed" }, 500);
    }
  }

  const event = String(body.event || "");
  const id = String(body.entity_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "invalid_entity" }, 400);
  try {
    const payload = await montar(event, id);
    if (!payload) return json({ ok: true, aviso_admin: event, ignorado: true });
    const result = await sendToAdmins(payload);
    return json({ ok: true, aviso_admin: event, ...result });
  } catch (err) {
    console.error("aviso admin", event, err);
    return json({ error: "aviso_admin_failed" }, 500);
  }
});
