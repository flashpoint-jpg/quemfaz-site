import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import webpush from "npm:web-push@3.6.7";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = "BEEKzUpJ3vaPQDakbiM0igTGDma4U3EPnH2TrV7PW_QguRgueQ_qPA1C5UnjISqnfudUVxC09B6prywwta4Z7J8";
const VAPID_PRIVATE = "e1N0TT0FE7spK2j47-M_T9p9qZuXn1tgI48Cf14BjLE";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

webpush.setVapidDetails("mailto:suporte@quemfaz.app", VAPID_PUBLIC, VAPID_PRIVATE);

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
  const { data } = await admin
    .from("qf_desbloqueios")
    .select("profissional_id")
    .eq("chamado_id", callId)
    .order("criado_em", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.profissional_id || null;
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

async function recipientsForNewCallAtRadius(call: any, _stageRadiusKm: number | null) {
  // Todo profissional ONLINE da categoria recebe o chamado.
  // A distância não bloqueia mais; serve só para informar o profissional.
  const { data: pros, error: prosErr } = await admin
    .from("qf_profissionais")
    .select("user_id,especialidades,online,latitude,longitude")
    .eq("online", true);

  if (prosErr) throw prosErr;

  const cLat = asNumber(call.latitude);
  const cLng = asNumber(call.longitude);
  const out: Array<{ user_id: string; distance_km: number | null; limit_km: number; exact_city: boolean }> = [];

  for (const p of pros || []) {
    const cats = Array.isArray(p.especialidades) ? p.especialidades : [];
    if (cats.length > 0 && !cats.includes(call.categoria)) continue;

    const pLat = asNumber(p.latitude);
    const pLng = asNumber(p.longitude);
    const distance =
      cLat != null && cLng != null && pLat != null && pLng != null
        ? distanceKm(pLat, pLng, cLat, cLng)
        : null;

    out.push({
      user_id: p.user_id,
      distance_km: distance,
      limit_km: 0,
      exact_city: false,
    });
  }

  out.sort((a, b) => {
    if (a.distance_km == null && b.distance_km == null) return 0;
    if (a.distance_km == null) return 1;
    if (b.distance_km == null) return -1;
    return a.distance_km - b.distance_km;
  });
  return out;
}

async function sendToUsers(userIds: string[], payload: any) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return { sent: 0, total: 0 };

  const { data: subs, error } = await admin
    .from("qf_push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth_key,user_agent")
    .in("user_id", ids)
    .eq("ativo", true);
  if (error) throw error;

  let sent = 0;
  for (const s of subs || []) {
    const endpoint = String(s.endpoint || "");
    if (endpoint.startsWith(FCM_PREFIX)) {
      if (!fcmAccount) continue;
      try {
        // V12: "apk android;v=12" (ou maior) recebe só dados.
        const m = /^apk android;v=(\d+)/.exec(String(s.user_agent || ""));
        const soDados = !!m && Number(m[1]) >= 12;
        const r = await sendFcm(endpoint.slice(FCM_PREFIX.length), payload, soDados);
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
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
        JSON.stringify(payload),
        { TTL: 90, urgency: payload.strong ? "high" : "normal" }
      );
      sent++;
    } catch (err: any) {
      const code = Number(err?.statusCode || err?.status || 0);
      if (code === 404 || code === 410) {
        await admin.from("qf_push_subscriptions")
          .update({ ativo: false, atualizado_em: new Date().toISOString() })
          .eq("id", s.id);
      }
    }
  }
  return { sent, total: (subs || []).length };
}

function newCallPayload(call: any) {
  return {
    title: call.prioridade ? "Chamado PRIORITÁRIO: " + (call.titulo || "serviço") : "Novo chamado: " + (call.titulo || "serviço"),
    body: [call.bairro, call.cidade, call.uf].filter(Boolean).join(" · ") + " — toque para ver",
    url: "/#/profissional/chamada/" + call.id,
    tag: "qf-new-call-" + call.id,
    strong: true,
  };
}

async function sendNewCallStage(callId: string, stageRadiusKm: number | null) {
  const { data: call, error } = await admin
    .from("qf_chamados")
    .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status,latitude,longitude,prioridade,criado_em")
    .eq("id", callId)
    .maybeSingle();

  if (error || !call || call.status !== "aberto") {
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

  const result = await sendToUsers(freshIds, newCallPayload(call));
  return { stopped: false, recipients: freshIds.length, ...result };
}

// V11.9: etapa 2 da cascata — ninguém aceitou a tempo: avisa TODOS os profissionais ativos
// da região e da categoria, online ou offline (lista montada no banco: qf_cascata_destinatarios).
async function sendCascadeStage2(callId: string) {
  const { data: call } = await admin
    .from("qf_chamados")
    .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status,latitude,longitude,prioridade,criado_em")
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.status !== "aberto" || (await professionalForCall(call.id))) {
    return { stopped: true, recipients: 0, sent: 0, total: 0 };
  }
  const { data: rows, error } = await admin.rpc("qf_cascata_destinatarios", { p_chamado_id: call.id });
  if (error) throw error;
  const ids = (Array.isArray(rows) ? rows : []).map((r: any) => r.user_id).filter(Boolean);

  let fresh: string[] = [];
  if (ids.length) {
    const { data: reserved, error: reserveErr } = await admin.rpc("qf_push_reservar_entregas", {
      p_chamado_id: call.id,
      p_user_ids: ids,
      p_evento: "new_call",
      p_raio_etapa_km: null,
    });
    if (reserveErr) throw reserveErr;
    fresh = Array.isArray(reserved) ? reserved : [];
  }
  const result = fresh.length ? await sendToUsers(fresh, newCallPayload(call)) : { sent: 0, total: 0 };
  await admin.from("qf_chamado_cascata")
    .update({ etapa2_destinatarios: ids.length, etapa2_enviados: result.sent, atualizado_em: new Date().toISOString() })
    .eq("chamado_id", call.id);
  return { stopped: false, recipients: ids.length, fresh: fresh.length, ...result };
}

// V11.9: etapa 3 — ainda sem aceite: o chamado entra em "Chamados sem resposta" no admin
// (botões de WhatsApp por profissional) e o admin recebe o aviso.
async function sendCascadeStage3(callId: string) {
  const { data: call } = await admin
    .from("qf_chamados")
    .select("id,categoria,titulo,cidade,uf,bairro,status")
    .eq("id", callId)
    .maybeSingle();
  if (!call || call.status !== "aberto" || (await professionalForCall(call.id))) {
    return { stopped: true };
  }
  const place = [call.bairro, call.cidade, call.uf].filter(Boolean).join(" · ");
  const { data: admins } = await admin.from("qf_admins").select("user_id");
  const adminResult = await sendToUsers((admins || []).map((a: any) => a.user_id), {
    title: "Chamado sem resposta: avise por WhatsApp",
    body: (call.titulo || "Serviço") + (place ? " · " + place : "") + " — ninguém aceitou. Toque para chamar os profissionais da região.",
    url: "/admin.html#sem-resposta",
    tag: "qf-sem-resposta-" + call.id,
    strong: true,
  });
  return { stopped: false, admin: adminResult };
}

async function progressiveNewCallPush(callId: string) {
  try {
    await sleep(30000);
    let stage = await sendNewCallStage(callId, 15);
    if (stage.stopped) return;

    await sleep(30000);
    stage = await sendNewCallStage(callId, 30);
    if (stage.stopped) return;

    await sleep(30000);
    await sendNewCallStage(callId, null);
  } catch (err) {
    console.error("progressiveNewCallPush", err);
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
        .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status")
        .eq("id", callId)
        .maybeSingle();
      if (!call || call.status !== "aberto" || (await professionalForCall(call.id))) {
        return json({ ok: true, stopped: true });
      }
      // Nova tentativa com todos os profissionais online (a reserva evita aviso repetido).
      const retry = await sendNewCallStage(call.id, null);
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

    const stages: Array<number | null> = [8, 15, 30, null];
    let delivered = { stopped: false, recipients: 0, sent: 0, total: 0 };
    for (const radius of stages) {
      const attempt = await sendNewCallStage(callId, radius);
      if (attempt.stopped) { delivered = attempt; break; }
      delivered = {
        stopped: false,
        recipients: Number(delivered.recipients || 0) + Number(attempt.recipients || 0),
        sent: Number(delivered.sent || 0) + Number(attempt.sent || 0),
        total: Number(delivered.total || 0) + Number(attempt.total || 0),
      };
      if (attempt.sent > 0) break;
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
    .select("id,cliente_id,categoria,titulo,cidade,uf,bairro,status,latitude,longitude,prioridade,criado_em")
    .eq("id", callId)
    .maybeSingle();
  if (callErr || !call) return json({ error: "call_not_found" }, 404);

  let recipients: string[] = [];
  let payload: any = { title: "QuemFaz", body: "Você tem uma atualização.", url: "/#/", tag: "quemfaz", strong: false };

  if (event === "new_call") {
    if (call.cliente_id !== user.id) return json({ error: "forbidden" }, 403);
    // V11.1: o gatilho do banco (qf_push_novo_chamado_after_insert) já dispara o aviso.
    // Mantido só por compatibilidade com versões antigas do app; a reserva evita aviso repetido.
    // Responde na hora (o cliente não fica esperando) e segue a entrega em segundo plano.
    EdgeRuntime.waitUntil((async () => {
      try {
        for (const radius of [8, 15, 30, null] as Array<number | null>) {
          const attempt = await sendNewCallStage(call.id, radius);
          if (attempt.stopped || attempt.sent > 0) break;
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
      body: (p?.nome || "Um profissional") + " assumiu seu chamado.",
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
    const pro = await professionalForCall(call.id);
    if (pro) recipients = [pro];
    const accepted = String(body.response || "") === "aceitar";
    payload = {
      title: accepted ? "Orçamento aprovado" : "Cliente respondeu ao orçamento",
      body: accepted ? "Você já pode iniciar o serviço." : "Abra o QuemFaz para ver a resposta do cliente.",
      url: "/#/profissional/pedido/" + call.id,
      tag: "qf-quote-response-" + call.id,
      strong: accepted,
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
      const pro = await professionalForCall(call.id);
      if (pro) recipients = [pro];
      payload = {
        title: "Chamado cancelado pelo cliente",
        body: detail + " — não precisa ir ao local.",
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
