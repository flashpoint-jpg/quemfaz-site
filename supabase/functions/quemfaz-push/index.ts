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
    signal: AbortSignal.timeout(10000),
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
      // V11.51: "Simular chamado" — mesmo aviso forte do chamado real, marcado como teste.
      tipo: String(payload.tipo || "chamado"),
      ...(payload.teste_id ? { teste_id: String(payload.teste_id), teste_token: String(payload.teste_token || "") } : {}),
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
    signal: AbortSignal.timeout(10000),
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
  const { data: limit, error } = await admin.rpc("qf_limite_orcamentos", { p_chamado_id: callId });
  if (error) throw error;
  return participants.length < Number(limit || 5);
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
type PushOutcome = { user_id: string; status: string; error: string | null };

// V11.92: de onde vem a inscrição web (Origin do navegador).
const PUSH_ORIGIN_OFICIAL = "https://quemfazservico.com.br";
const PUSH_ORIGINS_OK = new Set([PUSH_ORIGIN_OFICIAL, "https://www.quemfazservico.com.br", "https://quemfaz-site.vercel.app"]);
function webPushOrigin(req: Request): string {
  const o = String(req.headers.get("origin") || "").trim().toLowerCase().replace(/\/+$/, "");
  return o === "https://www.quemfazservico.com.br" ? PUSH_ORIGIN_OFICIAL : o;
}
// Mesmo aparelho/navegador, ignorando a versão do navegador (que muda a cada atualização).
function deviceSignature(ua: string): string {
  return String(ua || "").replace(/(Chrome|Edg|Firefox|Version|SamsungBrowser|OPR)\/[\d.]+/g, "$1").trim();
}
// Envio: inscrição web de endereço fora da lista não recebe (as antigas sem origem continuam).
function webSubOk(s: any): boolean {
  const o = String(s?.origem || "");
  return !o || PUSH_ORIGINS_OK.has(o);
}
async function sendToUsers(userIds: string[], payload: any, perUser?: Record<string, any>, audit?: (outcome: PushOutcome) => Promise<void>) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueIds.length) return { sent: 0, total: 0 };

  // Avisos para profissionais respeitam o horario escolhido, inclusive chat.
  // A consulta do portfolio continua independente do horario; nada e ocultado do app.
  const { data: professionalHours, error: hoursError } = await admin
    .from("qf_profissionais")
    .select("user_id,horario_inicio,horario_fim")
    .in("user_id", uniqueIds);
  if (hoursError) throw hoursError;
  const currentSaoPaulo = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date());
  const minutesOfDay = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const nowMinutes = minutesOfDay(currentSaoPaulo)!;
  const outside = new Set<string>();
  for (const professional of professionalHours || []) {
    const start = minutesOfDay(String(professional.horario_inicio || ""));
    const end = minutesOfDay(String(professional.horario_fim || ""));
    if (start === null || end === null || start === end) continue;
    const inside = start < end
      ? nowMinutes >= start && nowMinutes < end
      : nowMinutes >= start || nowMinutes < end;
    if (!inside) outside.add(String(professional.user_id));
  }
  const ids = uniqueIds.filter((uid) => !outside.has(uid));
  if (audit) for (const uid of outside) await audit({ user_id: uid, status: "fora_horario", error: null });
  if (!ids.length) return { sent: 0, total: 0, skipped_outside_hours: outside.size };

  const { data: subsRaw, error } = await admin
    .from("qf_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_key,user_agent,origem")
    .in("user_id", ids)
    .eq("ativo", true);
  if (error) throw error;
  const subs = (subsRaw || []).filter(webSubOk); // V11.92: só endereços oficiais

  // V11.11: modo do alerta escolhido por cada profissional (vai junto com o aviso para o app aplicar).
  const alertaPorUser: Record<string, string> = {};
  if (payload && payload.strong) {
    const { data: prefs } = await admin.from("qf_profissionais").select("user_id,alerta_modo").in("user_id", ids);
    for (const p of prefs || []) alertaPorUser[String(p.user_id)] = String(p.alerta_modo || "toque");
  }

  const webOk = await ensureVapid();
  let sent = 0;
  const errors: number[] = [];
  // Persist per person as soon as their devices have been attempted. A successful
  // device makes the person successful, so retries never resend to that person.
  for (const uid of ids) {
    const devices = (subs || []).filter((s: any) => String(s.user_id) === uid);
    let userSent = 0;
    let reason: string | null = null;
    for (const s of devices) {
      const endpoint = String(s.endpoint || "");
      const base = (perUser && perUser[uid]) || payload;
      const userPayload = alertaPorUser[uid] ? { ...base, alerta: alertaPorUser[uid] } : base;
      if (endpoint.startsWith(FCM_PREFIX)) {
        if (!fcmAccount) { reason = "fcm_not_configured"; continue; }
        try {
          const m = /^apk android;v=(\d+)/.exec(String(s.user_agent || ""));
          const result = await sendFcm(endpoint.slice(FCM_PREFIX.length), userPayload, !!m && Number(m[1]) >= 12);
          if (result === "ok") { sent++; userSent++; }
          else reason = result === "gone" ? "subscription_expired" : "fcm_send_failed";
          if (result === "gone") await admin.from("qf_push_subscriptions")
            .update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", s.id);
        } catch (_) { reason = "fcm_network_error"; }
      } else {
        if (!webOk) { reason = "vapid_not_configured"; continue; }
        try {
          await webpush.sendNotification(
            { endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            JSON.stringify(userPayload), { TTL: 300, urgency: payload.strong ? "high" : "normal", timeout: 10000 });
          sent++; userSent++;
        } catch (err: any) {
          const code = Number(err?.statusCode || err?.status || 0);
          errors.push(code); reason = "web_push_" + code;
          if ([404, 410, 401, 403].includes(code)) await admin.from("qf_push_subscriptions")
            .update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", s.id);
        }
      }
    }
    if (audit) await audit({ user_id: uid, status: userSent ? "enviado" : (devices.length ? "falhou" : "sem_inscricao"), error: userSent ? null : reason });
  }
  return { sent, total: (subs || []).length, ...(errors.length ? { errors } : {}) };
}

function newCallPayload(call: any) {
  const priority = !!call.prioridade;
  return {
    title: priority ? "Chamado PRIORITÁRIO: " + (call.titulo || "serviço") : "Novo chamado: " + (call.titulo || "serviço"),
    body: [call.bairro, call.cidade, call.uf].filter(Boolean).join(" · ") + " — toque para ver",
    url: "/#/profissional/servicos/disponiveis",
    // Cada pedido mantém seu próprio alerta forte. A reserva de entregas já
    // impede reenvios do mesmo pedido para o mesmo profissional.
    tag: (priority ? "qf-new-call-priority-" : "qf-new-call-") + call.id,
    strong: true,
    grouped: false,
    count: 1,
  };
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

async function sendNewCallStage(callId: string, stageRadiusKm: number | null, onlyUserId?: string) {
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
  const candidateIds = candidates.filter((x) => !onlyUserId || x.user_id === onlyUserId).map((x) => x.user_id);
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
  const audit = async (outcome: PushOutcome) => {
    const { error } = await admin.from("qf_push_entregas").update({
      envio_status: outcome.status, envio_erro: outcome.error,
      enviado_em: outcome.status === "enviado" ? new Date().toISOString() : null,
    }).eq("chamado_id", call.id).eq("user_id", outcome.user_id)
      .eq("evento", "new_call").eq("envio_status", "processando");
    if (error) throw error;
  };
  const result = await sendToUsers(freshIds, newCallPayload(call), perUser, audit);
  console.log("qf_push_delivery", JSON.stringify({ call_id: call.id, recipients: freshIds.length, ...result }));
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
  const openToAll = await notifyOpenToAll(call.id);
  return { stopped: false, expansion, admin: adminResult, aberto_todos: openToAll };
}

// V11.52: pedido virou "aberto a todos" (ninguém pegou depois da etapa 3): aviso comum, SEM toque de
// chamado, para quem é da mesma profissão em qualquer região e ainda não foi avisado desse pedido.
// Fica em qf_push_entregas com evento "aberto_todos" (não repete e não conta como aviso de chamado).
// "Abertos a todos" e somente vitrine no portfolio: nada de push/toque.
// A busca normal e a rechecagem na abertura do expediente continuam funcionando.
async function notifyOpenToAll(callId: string) {
  const { data: call } = await admin.from("qf_chamados")
    .select("id,status").eq("id", callId).maybeSingle();
  return { visible_in_portfolio: !!call && await callCanReceiveMore(callId, call.status), recipients: 0, sent: 0, total: 0 };
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
    
    // Profissional acaba de entrar no horario: recuperar pedidos ainda abertos.
    // Reaproveita todos os controles de categoria, distancia, vagas, online e
    // deduplicacao do mesmo push usado por chamados novos.
    if (event === "retry_call") {
      try { return json({ ok: true, event, ...(await sendNewCallStage(callId, 200)) }); }
      catch (_) { return json({ error: "retry_call_failed" }, 500); }
    }
    if (event === "shift_start") {
      const onlyUserId = String(body.user_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(onlyUserId)) {
        return json({ error: "invalid_professional_id" }, 400);
      }
      try {
        return json({ ok: true, event: "shift_start", ...(await sendNewCallStage(callId, 100, onlyUserId)) });
      } catch (err) {
        console.error("shift_start", err);
        return json({ error: "shift_start_failed" }, 500);
      }
    }


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
          title: "Um profissional desbloqueou seu pedido",
          body: "Converse com ele pelo chat. Se você não responder em até 48h, seu pedido será cancelado automaticamente.",
          url: "/#/cliente/pedido/" + call.id,
          tag: "qf-professional-connected-" + call.id,
          strong: true,
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

    if (event === "aberto_todos") {
      try {
        return json({ ok: true, aberto_todos: await notifyOpenToAll(callId) });
      } catch (err) {
        console.error("aberto_todos", err);
        return json({ error: "aberto_todos_failed" }, 500);
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

    // V11.92: notificação web só pelo domínio oficial. Cada endereço (domínio, quemfaz-site.vercel.app,
    // preview da Vercel) é um "site" diferente para o navegador: o mesmo aviso chegava repetido e o
    // Chrome marcava o endereço de preview como spam.
    const ua = String(req.headers.get("user-agent") || "").slice(0, 500);
    const origem = webPushOrigin(req);
    const agora = new Date().toISOString();
    if (!origem || !PUSH_ORIGINS_OK.has(origem)) {
      await admin.from("qf_push_subscriptions").update({ ativo: false, atualizado_em: agora }).eq("endpoint", endpoint);
      return json({ ok: false, wrong_origin: true, error: "Para receber notificações, abra o QuemFaz em quemfazservico.com.br." });
    }
    const aparelho = deviceSignature(ua);
    const { data: outras } = await admin.from("qf_push_subscriptions")
      .select("id,endpoint,user_agent,origem")
      .eq("user_id", user.id).eq("ativo", true).not("endpoint", "like", FCM_PREFIX + "%");
    const mesmoAparelho = (outras || []).filter((o: any) => o.endpoint !== endpoint && deviceSignature(String(o.user_agent || "")) === aparelho);
    if (origem !== PUSH_ORIGIN_OFICIAL && mesmoAparelho.some((o: any) => o.origem === PUSH_ORIGIN_OFICIAL)) {
      // Endereço antigo da Vercel num aparelho que já recebe pelo domínio oficial: não duplica.
      await admin.from("qf_push_subscriptions").update({ ativo: false, atualizado_em: agora }).eq("endpoint", endpoint);
      return json({ ok: true, skipped: "official_exists", vapid_public_key: VAPID_PUBLIC });
    }

    const { error } = await admin.from("qf_push_subscriptions").upsert({
      user_id: user.id,
      endpoint,
      p256dh,
      auth_key: authKey,
      user_agent: ua,
      origem,
      ativo: true,
      atualizado_em: agora,
    }, { onConflict: "endpoint" });
    if (error) return json({ error: error.message }, 400);
    if (origem === PUSH_ORIGIN_OFICIAL) {
      // Inscrição pelo domínio oficial substitui as antigas do mesmo aparelho (outros endereços).
      const velhas = mesmoAparelho.filter((o: any) => o.origem !== PUSH_ORIGIN_OFICIAL).map((o: any) => o.id);
      if (velhas.length) await admin.from("qf_push_subscriptions").update({ ativo: false, atualizado_em: agora }).in("id", velhas);
    }
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

  // V11.51: "Simular chamado" (só admin). Grava o teste em chamados_teste e manda o aviso para o
  // profissional pelo MESMO caminho do chamado real (strong: canal quemfaz_chamados, toque oficial,
  // tela cheia), com tipo "teste". Vai direto para ele: não olha online/offline nem horário.
  // Não cria pedido, não mexe em carteira e não entra em receita nem em contagem de pedidos.
  if (action === "teste_chamado") {
    const { data: isAdmin } = await admin.from("qf_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    if (!isAdmin) return json({ error: "forbidden" }, 403);
    const proId = String(body.profissional_id || "");
    if (!proId) return json({ error: "profissional_id_required" }, 400);
    const { data: pro } = await admin.from("qf_profissionais").select("user_id").eq("user_id", proId).maybeSingle();
    if (!pro) return json({ error: "professional_not_found" }, 404);
    const { data: teste, error: tErr } = await admin.from("chamados_teste")
      .insert({ profissional_id: proId, enviado_por: user.id })
      .select("id,token,enviado_em")
      .single();
    if (tErr || !teste) return json({ error: "teste_insert_failed" }, 500);
    const result = await sendToUsers([proId], {
      title: "Chamado de teste",
      body: "O QuemFaz está testando se o aviso de chamado chega no seu celular. Toque para confirmar.",
      url: "/#/profissional/teste/" + teste.id + "?t=" + teste.token,
      tag: "qf-teste-" + teste.id,
      strong: true,
      tipo: "teste",
      teste_id: teste.id,
      teste_token: teste.token,
    });
    await admin.from("chamados_teste").update({ envio: result }).eq("id", teste.id);
    return json({ ok: true, id: teste.id, enviado_em: teste.enviado_em, ...result });
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
      body: (p?.nome || "Um profissional") + " desbloqueou seu pedido. Responda pelo chat em até 48h para manter o pedido ativo.",
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

