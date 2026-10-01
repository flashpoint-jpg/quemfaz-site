import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import webpush from "npm:web-push@3.6.7";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// V11.9.1: par VAPID trocado. A chave pública pode ficar aqui (vai no site também);
// a privada NUNCA fica no código: vem do segredo VAPID_PRIVATE_KEY ou, sem ele, do Vault
// (segredo "qf_vapid_private", lido por qf_push_vapid_private(), que só o service_role executa).
const VAPID_PUBLIC = "BHKGLb0G49jDzmd6zoWU4HYzk8gAF3ilPMBx_-O3SMy1vPELJJZ6euC2XkSRcy8mF9MMYDKY9Lf7039nokcCHqw";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

let vapidReady: Promise<boolean> | null = null;
function ensureVapid(): Promise<boolean> {
  if (!vapidReady) {
    vapidReady = (async () => {
      let priv = (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim();
      if (!priv) {
        const { data, error } = await admin.rpc("qf_push_vapid_private");
        if (error) console.error("VAPID privada (Vault)", error.message);
        priv = String(data || "").trim();
      }
      if (!priv) {
        console.error("VAPID privada ausente: push web desativado");
        vapidReady = null;
        return false;
      }
      webpush.setVapidDetails("mailto:suporte@quemfaz.app", VAPID_PUBLIC, priv);
      return true;
    })().catch((err) => {
      console.error("VAPID", err);
      vapidReady = null;
      return false;
    });
  }
  return vapidReady;
}

// V11.1: push nativo (APK) via Firebase Cloud Messaging HTTP v1.
// Ativa sozinho quando o segredo FCM_SERVICE_ACCOUNT (JSON da conta de serviço do Firebase) existir.
const FCM_PREFIX = "fcm:";
let fcmAccount: any = null;
try {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT") || "";
  if (raw.trim()) fcmAccount = JSON.parse(raw);
  else console.error("FCM_SERVICE_ACCOUNT ausente: push do APK desativado");
} catch (err) {
  console.error("FCM_SERVICE_ACCOUNT inválido", err);
}
let fcmToken: { value: string; exp: number } | null = null;

async function getFcmAccessToken(): Promise<string | null> {
  if (!fcmAccount) return null;
  const now = Math.floor(Date.now() / 1000);
  if (fcmToken && fcmToken.exp - 120 > now) return fcmToken.value;
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
  if (!resp.ok || !out.access_token) {
    console.error("FCM token", resp.status, out);
    return null;
  }
  fcmToken = { value: out.access_token, exp: now + Number(out.expires_in || 3600) };
  return fcmToken.value;
}

// V11.7: além dos dados, manda o bloco "notification" com o canal do QuemFaz.
// Assim o próprio Android mostra o aviso com a tela apagada, mesmo se o sistema
// estiver segurando o app em segundo plano. Com o app aberto, o APK continua tratando os dados.
// V12: o APK novo (platform "android;v=12") recebe só dados: o próprio app monta o chamado
// como ligação (tela cheia + toque em loop) e fica acordado com o serviço "online".
async function sendFcm(token: string, payload: any, soDados = false): Promise<"ok" | "gone" | "error"> {
  const access = await getFcmAccessToken();
  if (!access) return "error";
  const strong = !!payload.strong;
  const channel = strong ? "quemfaz_chamados" : "quemfaz_avisos";
  const title = String(payload.title || "QuemFaz");
  const body = String(payload.body || "");
  const tag = String(payload.tag || "quemfaz");
  const message: any = {
    token,
    data: {
      title,
      body,
      url: String(payload.url || "/#/"),
      tag,
      strong: strong ? "1" : "0",
      channel,
      // V11.11: preferência do profissional ("toque" = toque + vibração, "vibrar" = só vibração).
      alerta: String(payload.alerta || "toque"),
      grouped: payload.grouped ? "1" : "0",
      count: String(Math.max(0, Number(payload.count || 0))),
    },
    android: {
      priority: "HIGH",
      ttl: strong ? "300s" : "3600s",
    },
  };
  if (!soDados) {
    message.notification = { title, body };
    message.android.notification = {
      channel_id: channel,
      tag,
      notification_priority: strong ? "PRIORITY_MAX" : "PRIORITY_DEFAULT",
      visibility: "PUBLIC",
      default_vibrate_timings: true,
      default_light_settings: true,
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

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function norm(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function asNumber(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getUser(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function professionalForCall(callId: string) {
  // No fluxo com vários orçamentos, "profissional do chamado" é somente quem
  // teve o orçamento aceito pelo cliente.
  const { data } = await admin
    .from("qf_orcamentos")
    .select("profissional_id")
    .eq("chamado_id", callId)
    .eq("status", "aceito")
    .order("atualizado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.profissional_id || null;
}

async function participantsForCall(callId: string) {
  const { data } = await admin
    .from("qf_desbloqueios")
    .select("profissional_id")
    .eq("chamado_id", callId)
    .eq("ativo", true);
  return Array.from(new Set((data || []).map((r: any) => String(r.profissional_id || "")).filter(Boolean)));
}

async function quoteProfessional(callId: string, quoteId: string) {
  if (!quoteId) return null;
  const { data } = await admin
    .from("qf_orcamentos")
    .select("profissional_id,chamado_id")
    .eq("id", quoteId)
    .eq("chamado_id", callId)
    .maybeSingle();
  return data?.profissional_id || null;
}

async function callCanReceiveMore(callId: string, status?: string | null) {
  if (status && status !== "aberto" && status !== "em_negociacao") return false;
  const accepted = await professionalForCall(callId);
  if (accepted) return false;
  const participants = await participantsForCall(callId);
  return participants.length < 5;
}

async function actorUnlocked(callId: string, userId: string) {
  const { data } = await admin
    .from("qf_desbloqueios")
    .select("id")
    .eq("chamado_id", callId)
    .eq("profissional_id", userId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function recipientsForNewCallAtRadius(call: any, stageRadiusKm: number | null) {
  // Cascata geográfica:
  // 0 km = somente a cidade/UF escolhida pelo cliente.
  // Depois amplia para profissionais da mesma categoria em cidades/localizações próximas.
  const raio = Math.max(0, Number(stageRadiusKm || 0));
  const { data: rows, error } = await admin.rpc("qf_chamado_destinatarios_alcance", {
    p_chamado_id: call.id,
    p_raio_km: raio,
  });
  if (error) throw error;

  return (Array.isArray(rows) ? rows : []).map((r: any) => ({
    user_id: String(r.user_id),
    distance_km: r.distancia_regiao_km == null ? null : Number(r.distancia_regiao_km),
    limit_km: raio,
    exact_city: raio === 0,
  }));
}

// V11.13: perUser = aviso próprio de cada profissional (distância, tempo e preço dele).
async function sendToUsers(userIds: string[], payload: any, perUser?: Record<string, any>) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return { sent: 0, total: 0 };

  const { data: subs, error } = await admin
    .from("qf_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_key,user_agent")
    .in("user_id", ids)
    .eq("ativo", true);
  if (error) throw error;

  // V11.11: modo do alerta escolhido por cada profissional (vai junto com o aviso para o app aplicar).
  const alertaPorUser: Record<string, string> = {};
  if (payload && payload.strong) {
    const { data: prefs } = await admin.from("qf_profissionais").select("user_id,alerta_modo").in("user_id", ids);
    for (const p of prefs || []) alertaPorUser[String(p.user_id)] = String(p.alerta_modo || "toque");
  }

  const webOk = await ensureVapid();
  let sent = 0;
  const errors: number[] = [];
  for (const s of subs || []) {
    const endpoint = String(s.endpoint || "");
    if (endpoint.startsWith(FCM_PREFIX)) {
      if (!fcmAccount) continue;
      try {
        // V12: "apk android;v=12" (ou maior) recebe só dados.
        const m = /^apk android;v=(\d+)/.exec(String(s.user_agent || ""));
        const soDados = !!m && Number(m[1]) >= 12;
        const base = (perUser && perUser[String(s.user_id)]) || payload;
        const userPayload = alertaPorUser[String(s.user_id)] ? { ...base, alerta: alertaPorUser[String(s.user_id)] } : base;
        const r = await sendFcm(endpoint.slice(FCM_PREFIX.length), userPayload, soDados);
        if (r === "ok") sent++;
        if (r === "gone") {
          await admin.from("qf_push_subscriptions")
            .update({ ativo: false, atualizado_em: new Date().toISOString() })
            .eq("id", s.id);
        }
      } catch (err) {
        console.error("FCM", err);
      }
      continue;
    }
    if (!webOk) continue;
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        JSON.stringify((perUser && perUser[String(s.user_id)]) || payload),
        { TTL: 90, urgency: payload.strong ? "high" : "normal" }
      );
      sent++;
    } catch (err: any) {
      const code = Number(err?.statusCode || err?.status || 0);
      errors.push(code);
      // 401/403: inscrição feita com a chave VAPID antiga. Desativa; o app se reinscreve ao abrir.
      if (code === 404 || code === 410 || code === 401 || code === 403) {
        await admin.from("qf_push_subscriptions")
          .update({ ativo: false, atualizado_em: new Date().toISOString() })
          .eq("id", s.id);
      }
    }
  }
  return errors.length ? { sent, total: (subs || []).length, errors } : { sent, total: (subs || []).length };
}

function newCallPayload(call: any) {
  const priority = !!call.prioridade;
  return {
    title: priority ? "Chamado PRIORITÁRIO: " + (call.titulo || "serviço") : "Novo chamado: " + (call.titulo || "serviço"),
    body: [call.bairro, call.cidade, call.uf].filter(Boolean).join(" · ") + " — toque para ver",
    url: "/#/profissional/chamada/" + call.id,
    // Chamados normais compartilham a mesma tag: o Android/PWA substitui o aviso anterior
    // em vez de empilhar dezenas. Prioridade paga continua individual.
    tag: priority ? "qf-new-call-priority-" + call.id : "qf-new-calls-group",
    strong: true,
    grouped: false,
    count: 1,
  };
}

function groupedNormalPayload(call: any, count: number) {
  const n = Math.max(2, Number(count || 2));
  const place = [call.cidade, call.uf].filter(Boolean).join(" · ");
  return {
    title: n + " novos chamados na sua região",
    body: "Último: " + (call.titulo || "Serviço") + (place ? " · " + place : "") + " — toque para ver todos",
    url: "/#/profissional/home",
    tag: "qf-new-calls-group",
    // O primeiro chamado já tocou forte. Os seguintes atualizam o mesmo aviso sem virar outra ligação.
    strong: false,
    grouped: true,
    count: n,
  };
}

async function recentNormalCallCounts(userIds: string[]) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  const out: Record<string, number> = {};
  ids.forEach((id) => { out[id] = 0; });
  if (!ids.length) return out;

  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: deliveries, error } = await admin
    .from("qf_push_entregas")
    .select("user_id,chamado_id,criado_em")
    .in("user_id", ids)
    .eq("evento", "new_call")
    .gte("criado_em", cutoff);
  if (error) {
    console.error("agrupamento chamados", error);
    return out;
  }

  const callIds = Array.from(new Set((deliveries || []).map((r: any) => String(r.chamado_id || "")).filter(Boolean)));
  if (!callIds.length) return out;

  const { data: calls, error: callErr } = await admin
    .from("qf_chamados")
    .select("id,status,prioridade")
    .in("id", callIds);
  if (callErr) {
    console.error("agrupamento chamados status", callErr);
    return out;
  }

  const valid = new Set((calls || [])
    .filter((c: any) => (c.status === "aberto" || c.status === "em_negociacao") && !c.prioridade)
    .map((c: any) => String(c.id)));

  const seen: Record<string, Set<string>> = {};
  ids.forEach((id) => { seen[id] = new Set<string>(); });
  for (const row of deliveries || []) {
    const uid = String((row as any).user_id || "");
    const cid = String((row as any).chamado_id || "");
    if (seen[uid] && valid.has(cid)) seen[uid].add(cid);
  }
  ids.forEach((id) => { out[id] = seen[id].size; });
  return out;
}

// V11.13: aviso de chamado já detalhado para cada profissional (só o contato do cliente fica escondido).
function fmtKm(km: number) { return km.toFixed(1).replace(".", ",") + " km"; }
function fmtMin(m: number) {
  if (m >= 60) { const h = Math.floor(m / 60), r = m % 60; return "~" + h + " h" + (r ? " " + r + " min" : ""); }
  return "~" + m + " min";
}
function fmtBRL(c: number) { return "R$ " + (c / 100).toFixed(2).replace(".", ","); }

function newCallBody(call: any, d: any) {
  const parts: string[] = [];
  if (call?.data_preferida) {
    try {
      const when = new Date(call.data_preferida);
      if (!Number.isNaN(when.getTime())) {
        const label = when.toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
        });
        parts.push("Execução " + label);
      }
    } catch (_) {}
  }
  const km = d.distancia_km == null ? null : Number(d.distancia_km);
  const min = d.tempo_min == null ? null : Number(d.tempo_min);
  if (km != null && Number.isFinite(km)) parts.push(fmtKm(km) + (min != null && Number.isFinite(min) ? " (" + fmtMin(min) + ")" : ""));
  parts.push(Number(d.plano_restantes) > 0 ? "Desbloqueio pelo seu plano" : "Desbloqueio " + fmtBRL(Number(d.preco_centavos || 0)));
  const place = [call.bairro, call.cidade].filter(Boolean).join(", ");
  if (place) parts.push(place);
  let body = parts.join(" · ");
  const desc = String(d.descricao || "").replace(/\s+/g, " ").trim();
  if (desc) body += "\n\u201c" + (desc.length > 120 ? desc.slice(0, 117).trimEnd() + "\u2026" : desc) + "\u201d";
  const media: string[] = [];
  const f = Number(d.fotos || 0), v = Number(d.videos || 0);
  if (f > 0) media.push(f + (f > 1 ? " fotos" : " foto"));
  if (v > 0) media.push(v + (v > 1 ? " vídeos" : " vídeo"));
  if (media.length) body += "\n" + media.join(" + ") + " — toque para ver";
  return body;
}

async function newCallPayloads(call: any, userIds: string[]) {
  const out: Record<string, any> = {};
  if (!userIds.length) return out;
  try {
    const base = newCallPayload(call);
    const { data, error } = await admin.rpc("qf_push_detalhes_chamado", { p_chamado_id: call.id, p_user_ids: userIds });
    if (error) throw error;
    for (const r of data || []) out[String(r.user_id)] = { ...base, body: newCallBody(call, r) };
  } catch (err) {
    console.error("detalhes do chamado", err);
  }
  return out;
}

async function sendNewCallStage(callId: string, stageRadiusKm: number | null) {
  const { data: call, error } = await admin
    .from("qf_chamados")
    .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status,latitude,longitude,prioridade,criado_em,data_preferida")
    .eq("id", callId)
    .maybeSingle();

  if (error || !call || !(await callCanReceiveMore(callId, call.status))) {
    return {
      stopped: true,
      recipients: 0,
      sent: 0,
      total: 0,
      debug: {
        error: error ? String(error.message || error) : null,
        has_call: !!call,
        status: call ? call.status : null,
        call_id: callId
      }
    };
  }

  // Serviço programado fica visível no portfólio, mas o alerta forte só começa
  // quando faltarem no máximo 24 horas para a execução.
  if (call.data_preferida) {
    const scheduledAt = Date.parse(String(call.data_preferida));
    if (Number.isFinite(scheduledAt) && scheduledAt > Date.now() + 24 * 60 * 60 * 1000) {
      return { stopped: true, scheduled: true, recipients: 0, sent: 0, total: 0, call_id: callId };
    }
  }

  const candidates = await recipientsForNewCallAtRadius(call, stageRadiusKm);
  const candidateIds = candidates.map((x) => x.user_id);
  if (!candidateIds.length) {
    return { stopped: false, recipients: 0, sent: 0, total: 0 };
  }

  const { data: reserved, error: reserveErr } = await admin.rpc("qf_push_reservar_entregas", {
    p_chamado_id: call.id,
    p_user_ids: candidateIds,
    p_evento: "new_call",
    p_raio_etapa_km: stageRadiusKm,
  });
  if (reserveErr) throw reserveErr;

  const freshIds = Array.isArray(reserved) ? reserved : [];
  if (!freshIds.length) {
    return { stopped: false, recipients: 0, sent: 0, total: 0 };
  }

  const perUser = await newCallPayloads(call, freshIds);
  if (!call.prioridade) {
    const counts = await recentNormalCallCounts(freshIds);
    for (const uid of freshIds) {
      const n = Number(counts[String(uid)] || 0);
      if (n >= 2) perUser[String(uid)] = groupedNormalPayload(call, n);
    }
  }
  const result = await sendToUsers(freshIds, newCallPayload(call), perUser);
  return { stopped: false, recipients: freshIds.length, ...result };
}

// V11.9: etapa 2 da cascata — ninguém aceitou a tempo: avisa TODOS os profissionais ativos
// da região e da categoria, online ou offline (lista montada no banco: qf_cascata_destinatarios).
async function sendCascadeStage2(callId: string) {
  // Sem aceite após a primeira etapa: amplia para até 30 km.
  const result = await sendNewCallStage(callId, 30);
  if (!result.stopped) {
    await admin.from("qf_chamado_cascata")
      .update({
        etapa2_destinatarios: Number(result.recipients || 0),
        etapa2_enviados: Number(result.sent || 0),
        atualizado_em: new Date().toISOString(),
      })
      .eq("chamado_id", callId);
  }
  return result;
}

// V11.9: etapa 3 — ainda sem aceite: o chamado entra em "Chamados sem resposta" no admin
// (botões de WhatsApp por profissional) e o admin recebe o aviso.
async function sendCascadeStage3(callId: string) {
  // Ainda sem aceite: amplia para até 100 km antes de escalar ao admin.
  const expansion = await sendNewCallStage(callId, 100);
  if (expansion.stopped) return expansion;

  const { data: call } = await admin
    .from("qf_chamados")
    .select("id,categoria,titulo,cidade,uf,bairro,status")
    .eq("id", callId)
    .maybeSingle();
  if (!call || !(await callCanReceiveMore(call.id, call.status))) {
    return { stopped: true };
  }

  const place = [call.bairro, call.cidade, call.uf].filter(Boolean).join(" · ");
  const { data: admins } = await admin.from("qf_admins").select("user_id");
  const adminResult = await sendToUsers((admins || []).map((a: any) => a.user_id), {
    title: "Chamado sem resposta: alcance ampliado",
    body: (call.titulo || "Serviço") + (place ? " · " + place : "") + " — busca ampliada para cidades próximas.",
    url: "/admin.html#sem-resposta",
    tag: "qf-sem-resposta-" + call.id,
    strong: true,
  });
  return { stopped: false, expansion, admin: adminResult };
}

async function progressiveNewCallPush(callId: string) {
  try {
    // Dá prioridade à cidade escolhida. Se ninguém aceitar, amplia gradualmente.
    await sleep(30000);
    let stage = await sendNewCallStage(callId, 15);
    if (stage.stopped) return;

    await sleep(30000);
    stage = await sendNewCallStage(callId, 30);
    if (stage.stopped) return;

    await sleep(30000);
    await sendNewCallStage(callId, 60);
  } catch (err) {
    console.error("progressiveNewCallPush", err);
  }
}

async function progressivePriorityBoost(callId: string) {
  try {
    // Prioridade paga: amplia bem mais rápido que a busca normal.
    await sleep(12000);
    let stage = await sendNewCallStage(callId, 60);
    if (stage.stopped) return;

    await sleep(12000);
    await sendNewCallStage(callId, 100);
  } catch (err) {
    console.error("progressivePriorityBoost", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action === "notify_internal") {
    // V11.6: só o banco (com a senha interna guardada no Vault) pode chamar esta parte.
    const secret = String(req.headers.get("x-qf-internal") || "");
    if (secret.length < 32) return json({ error: "unauthorized" }, 401);
    const { data: okSecret } = await admin.rpc("qf_push_internal_ok", { p_segredo: secret });
    if (okSecret !== true) return json({ error: "unauthorized" }, 401);

    const event = String(body.event || "");
    const callId = String(body.call_id || "");
    if (!callId) return json({ error: "invalid_internal_event" }, 400);

    if (event === "professional_connected") {
      try {
        const { data: call } = await admin
          .from("qf_chamados")
          .select("id,cliente_id,titulo,status")
          .eq("id", callId)
          .maybeSingle();
        if (!call) return json({ ok: true, stopped: true });
        const participants = await participantsForCall(callId);
        const n = participants.length;
        const clientResult = await sendToUsers([call.cliente_id], {
          title: "Novo profissional participando",
          body: n + " de 5 profissionais " + (n === 1 ? "já entrou na conversa." : "já entraram na conversa.") + " Você pode conversar e escolher com quem fechar.",
          url: "/#/cliente/pedido/" + call.id,
          tag: "qf-participants-" + call.id,
          strong: false,
        });
        return json({ ok: true, participants: n, client: clientResult });
      } catch (err) {
        console.error("professional_connected", err);
        return json({ error: "professional_connected_failed" }, 500);
      }
    }

    if (event === "chat_message") {
      try {
        const { data: call } = await admin
          .from("qf_chamados")
          .select("id,cliente_id,titulo,status")
          .eq("id", callId)
          .maybeSingle();
        const { data: msg } = await admin
          .from("qf_chat_mensagens")
          .select("id,profissional_id,remetente_id,mensagem,criado_em")
          .eq("chamado_id", callId)
          .order("criado_em", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!call || !msg) return json({ ok: true, stopped: true });

        const recipient = String(msg.remetente_id) === String(call.cliente_id)
          ? String(msg.profissional_id)
          : String(call.cliente_id);
        const { data: sender } = await admin
          .from("qf_profiles")
          .select("nome")
          .eq("id", msg.remetente_id)
          .maybeSingle();
        const raw = String(msg.mensagem || "").replace(/\s+/g, " ").trim();
        const preview = raw.length > 120 ? raw.slice(0, 117).trimEnd() + "…" : raw;
        const toClient = recipient === String(call.cliente_id);
        const result = await sendToUsers([recipient], {
          title: "Nova mensagem de " + (sender?.nome || (toClient ? "profissional" : "cliente")),
          body: preview || "Abra o QuemFaz para continuar a conversa.",
          url: toClient
            ? "/#/cliente/chat/" + call.id + "/" + msg.profissional_id
            : "/#/profissional/chat/" + call.id,
          tag: "qf-chat-" + call.id + "-" + msg.profissional_id,
          strong: false,
        });
        return json({ ok: true, chat: result });
      } catch (err) {
        console.error("chat_message", err);
        return json({ error: "chat_message_failed" }, 500);
      }
    }

    if (event === "professional_selected") {
      try {
        const { data: call } = await admin
          .from("qf_chamados")
          .select("id,cliente_id,titulo,status")
          .eq("id", callId)
          .maybeSingle();
        const chosen = await professionalForCall(callId);
        if (!call || !chosen) return json({ ok: true, stopped: true });

        const participants = await participantsForCall(callId);
        const others = participants.filter((id) => id !== chosen);
        const selectedResult = await sendToUsers([chosen], {
          title: "Serviço confirmado",
          body: "O cliente escolheu você. Endereço e contato foram liberados para combinar a execução.",
          url: "/#/profissional/pedido/" + call.id,
          tag: "qf-selected-" + call.id,
          strong: true,
        });
        const othersResult = await sendToUsers(others, {
          title: "Cliente escolheu outro profissional",
          body: "Este serviço foi fechado com outro profissional. Continue de olho no portfólio.",
          url: "/#/profissional/pedido/" + call.id,
          tag: "qf-not-selected-" + call.id,
          strong: false,
        });
        return json({ ok: true, selected: selectedResult, not_selected: othersResult });
      } catch (err) {
        console.error("professional_selected", err);
        return json({ error: "professional_selected_failed" }, 500);
      }
    }

    if (event === "priority_boost") {
      try {
        // Assim que o pagamento é aprovado, já amplia para 30 km.
        const boosted = await sendNewCallStage(callId, 30);
        if (!boosted.stopped) EdgeRuntime.waitUntil(progressivePriorityBoost(callId));
        return json({ ok: true, priority: true, ...boosted });
      } catch (err) {
        console.error("priority_boost", err);
        return json({ error: "priority_boost_failed" }, 500);
      }
    }

    if (event === "cascade_stage2") {
      try {
        return json({ ok: true, stage: 2, ...(await sendCascadeStage2(callId)) });
      } catch (err) {
        console.error("cascade_stage2", err);
        return json({ error: "cascade_stage2_failed" }, 500);
      }
    }

    if (event === "cascade_stage3") {
      try {
        return json({ ok: true, stage: 3, ...(await sendCascadeStage3(callId)) });
      } catch (err) {
        console.error("cascade_stage3", err);
        return json({ error: "cascade_stage3_failed" }, 500);
      }
    }

    if (event === "stale_call") {
      // V11.6: chamado aberto há 10 min sem ninguém aceitar.
      const { data: call } = await admin
        .from("qf_chamados")
        .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status,data_preferida")
        .eq("id", callId)
        .maybeSingle();
      if (!call || !(await callCanReceiveMore(call.id, call.status))) {
        return json({ ok: true, stopped: true });
      }
      if (call.data_preferida) {
        const scheduledAt = Date.parse(String(call.data_preferida));
        if (Number.isFinite(scheduledAt) && scheduledAt > Date.now() + 24 * 60 * 60 * 1000) {
          return json({ ok: true, stopped: true, scheduled: true });
        }
      }
      // Última ampliação automática de segurança: até 200 km.
      const retry = await sendNewCallStage(call.id, 200);
      const place = [call.bairro, call.cidade, call.uf].filter(Boolean).join(" · ");
      const { data: admins } = await admin.from("qf_admins").select("user_id");
      const adminResult = await sendToUsers((admins || []).map((a: any) => a.user_id), {
        title: "Chamado sem resposta há 10 min",
        body: (call.titulo || "Serviço") + (place ? " · " + place : "") + " — ninguém aceitou ainda.",
        url: "/admin.html#parados",
        tag: "qf-stale-" + call.id,
        strong: true,
      });
      const clientResult = await sendToUsers([call.cliente_id], {
        title: "Ainda estamos procurando",
        body: "Seu pedido continua ativo. Avisamos mais profissionais perto de você.",
        url: "/#/cliente/pedido/" + call.id,
        tag: "qf-stale-client-" + call.id,
        strong: false,
      });
      return json({ ok: true, retry, admin: adminResult, client: clientResult });
    }

    if (event !== "new_call") return json({ error: "invalid_internal_event" }, 400);

    // Primeiro tenta SOMENTE a cidade escolhida pelo cliente.
    let delivered = await sendNewCallStage(callId, 0);

    // Se não existe nenhum profissional dessa categoria na cidade, começa a ampliar já,
    // sem fazer o cliente esperar inutilmente.
    if (!delivered.stopped && Number(delivered.recipients || 0) === 0) {
      for (const radius of [15, 30, 60]) {
        const attempt = await sendNewCallStage(callId, radius);
        delivered = attempt;
        if (attempt.stopped || Number(attempt.recipients || 0) > 0) break;
      }
    }

    EdgeRuntime.waitUntil(progressiveNewCallPush(callId));
    return json({ ok: true, internal: true, ...delivered });
  }

  const user = await getUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  if (action === "subscribe") {
    const sub = body.subscription || {};
    const endpoint = String(sub.endpoint || "");
    const p256dh = String(sub.keys?.p256dh || "");
    const authKey = String(sub.keys?.auth || "");
    if (!endpoint || !p256dh || !authKey) return json({ error: "invalid_subscription" }, 400);

    const { error } = await admin.from("qf_push_subscriptions").upsert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth_key: authKey,
      user_agent: String(req.headers.get("user-agent") || "").slice(0, 500),
      ativo: true,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, vapid_public_key: VAPID_PUBLIC });
  }

  // V11.9.1: aviso de teste só para os aparelhos do próprio usuário (diagnóstico).
  if (action === "test_self") {
    const result = await sendToUsers([user.id], {
      title: "Teste de notificação",
      body: "Se você está vendo isto, as notificações do QuemFaz estão funcionando.",
      url: "/#/",
      tag: "qf-test-" + Date.now(),
      strong: false,
    });
    return json({ ok: true, ...result });
  }

  // V11.1: registro do token do Firebase enviado pelo APK.
  if (action === "subscribe_fcm") {
    const token = String(body.token || "").trim();
    if (!token || token.length < 20 || token.length > 4096) return json({ error: "invalid_token" }, 400);
    const { error } = await admin.from("qf_push_subscriptions").upsert({
      user_id: user.id,
      endpoint: FCM_PREFIX + token,
      p256dh: "fcm",
      auth_key: "fcm",
      user_agent: ("apk " + String(body.platform || "android") + " | " + String(req.headers.get("user-agent") || "")).slice(0, 500),
      ativo: true,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "endpoint" });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, fcm_ready: !!fcmAccount });
  }

  if (action === "unsubscribe_fcm") {
    const token = String(body.token || "").trim();
    if (!token) return json({ error: "invalid_token" }, 400);
    await admin.from("qf_push_subscriptions")
      .update({ ativo: false, atualizado_em: new Date().toISOString() })
      .eq("endpoint", FCM_PREFIX + token)
      .eq("user_id", user.id);
    return json({ ok: true });
  }

  if (action !== "notify") return json({ error: "invalid_action" }, 400);

  const event = String(body.event || "");
  const callId = String(body.call_id || "");
  if (!callId) return json({ error: "call_id_required" }, 400);

  const { data: call, error: callErr } = await admin
    .from("qf_chamados")
    .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status,latitude,longitude,prioridade,criado_em,data_preferida")
    .eq("id", callId)
    .maybeSingle();
  if (callErr || !call) return json({ error: "call_not_found" }, 404);

  let recipients: string[] = [];
  let payload: any = { title: "QuemFaz", body: "Você tem uma atualização.", url: "/#/", tag: "quemfaz", strong: false };

  if (event === "new_call") {
    if (call.cliente_id !== user.id) return json({ error: "forbidden" }, 403);
    if (call.data_preferida) {
      const scheduledAt = Date.parse(String(call.data_preferida));
      if (Number.isFinite(scheduledAt) && scheduledAt > Date.now() + 24 * 60 * 60 * 1000) {
        return json({ ok: true, scheduled: true, queued: false });
      }
    }
    // V11.1: o gatilho do banco (qf_push_novo_chamado_after_insert) já dispara o aviso.
    // Mantido só por compatibilidade com versões antigas do app; a reserva evita aviso repetido.
    // Responde na hora (o cliente não fica esperando) e segue a entrega em segundo plano.
    EdgeRuntime.waitUntil((async () => {
      try {
        let first = await sendNewCallStage(call.id, 0);
        if (!first.stopped && Number(first.recipients || 0) === 0) {
          for (const radius of [15, 30, 60]) {
            const attempt = await sendNewCallStage(call.id, radius);
            first = attempt;
            if (attempt.stopped || Number(attempt.recipients || 0) > 0) break;
          }
        }
        await progressiveNewCallPush(call.id);
      } catch (err) {
        console.error("new_call via cliente", err);
      }
    })());
    return json({ ok: true, via_client: true, queued: true });
  } else if (event === "professional_connected") {
    if (!(await actorUnlocked(call.id, user.id))) return json({ error: "forbidden" }, 403);
    recipients = [call.cliente_id];
    const { data: p } = await admin.from("qf_profiles").select("nome").eq("id", user.id).maybeSingle();
    payload = {
      title: "Profissional encontrado",
      body: (p?.nome || "Um profissional") + " desbloqueou seu pedido e já pode conversar com você pelo chat.",
      url: "/#/cliente/pedido/" + call.id,
      tag: "qf-connected-" + call.id,
      strong: true,
    };
  } else if (event === "quote_sent") {
    if (!(await actorUnlocked(call.id, user.id))) return json({ error: "forbidden" }, 403);
    recipients = [call.cliente_id];
    payload = {
      title: "Novo orçamento recebido",
      body: "Abra o QuemFaz para conferir e aprovar ou recusar.",
      url: "/#/cliente/pedido/" + call.id,
      tag: "qf-quote-" + call.id,
      strong: true,
    };
  } else if (event === "quote_response") {
    if (call.cliente_id !== user.id) return json({ error: "forbidden" }, 403);
    const quoteId = String(body.quote_id || "");
    const pro = await quoteProfessional(call.id, quoteId);
    if (!pro) return json({ error: "quote_not_found" }, 404);
    const accepted = String(body.response || "") === "aceitar";

    if (accepted) {
      const participants = await participantsForCall(call.id);
      const others = participants.filter((id) => id !== pro);
      const chosenResult = await sendToUsers([pro], {
        title: "Orçamento aprovado",
        body: "O cliente escolheu seu orçamento. Você já pode iniciar o serviço.",
        url: "/#/profissional/pedido/" + call.id,
        tag: "qf-quote-approved-" + call.id,
        strong: true,
      });
      const othersResult = await sendToUsers(others, {
        title: "Cliente escolheu outro profissional",
        body: "Seu orçamento não foi selecionado desta vez. O chamado foi encerrado para novos orçamentos.",
        url: "/#/profissional/pedido/" + call.id,
        tag: "qf-quote-not-selected-" + call.id,
        strong: false,
      });
      return json({ ok: true, selected: chosenResult, not_selected: othersResult });
    }

    recipients = [pro];
    payload = {
      title: "Cliente respondeu ao seu orçamento",
      body: "Abra o QuemFaz para ver a resposta do cliente.",
      url: "/#/profissional/pedido/" + call.id,
      tag: "qf-quote-response-" + quoteId,
      strong: false,
    };
  } else if (event === "service_started") {
    // V11.1: antes este evento era recusado (400) e o cliente não era avisado.
    if (!(await actorUnlocked(call.id, user.id))) return json({ error: "forbidden" }, 403);
    recipients = [call.cliente_id];
    payload = {
      title: "Serviço iniciado",
      body: "O profissional começou o atendimento" + (call.titulo ? ": " + call.titulo : "") + ".",
      url: "/#/cliente/pedido/" + call.id,
      tag: "qf-started-" + call.id,
      strong: false,
    };
  } else if (event === "call_cancelled") {
    // V11.1: antes este evento era recusado (400) e a outra parte não era avisada.
    const place = [call.bairro, call.cidade].filter(Boolean).join(" · ");
    const detail = (call.titulo || "Serviço") + (place ? " · " + place : "");
    if (call.cliente_id === user.id) {
      recipients = await participantsForCall(call.id);
      payload = {
        title: "Chamado cancelado pelo cliente",
        body: detail + " — o pedido foi encerrado.",
        url: "/#/profissional/pedido/" + call.id,
        tag: "qf-cancel-" + call.id,
        strong: true,
      };
    } else if (await actorUnlocked(call.id, user.id)) {
      recipients = [call.cliente_id];
      payload = {
        title: "O profissional cancelou o atendimento",
        body: detail + " — abra o QuemFaz para pedir outro profissional.",
        url: "/#/cliente/pedido/" + call.id,
        tag: "qf-cancel-" + call.id,
        strong: true,
      };
    } else {
      return json({ error: "forbidden" }, 403);
    }
  } else if (event === "service_complete") {
    if (!(await actorUnlocked(call.id, user.id))) return json({ error: "forbidden" }, 403);
    recipients = [call.cliente_id];
    payload = {
      title: "Serviço concluído",
      body: "O profissional marcou o serviço como concluído. Abra para avaliar.",
      url: "/#/cliente/pedido/" + call.id,
      tag: "qf-complete-" + call.id,
      strong: true,
    };
  } else {
    return json({ error: "invalid_event" }, 400);
  }

  const result = await sendToUsers(recipients, payload);
  return json({ ok: true, recipients: recipients.length, ...result });
});
