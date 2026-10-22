import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const FROM_PROD = "QuemFaz <avisos@quemfazservico.com.br>";
const FROM_TESTE = "QuemFaz <onboarding@resend.dev>";
const LINK = "https://quemfazservico.com.br/?utm_source=email&utm_medium=ativar_push&utm_campaign=push_inativo#/profissional/home";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function profissao(esp: string[] | null): string {
  const c = (esp || []).find((x) => x && !x.startsWith("cat_custom_"));
  if (!c) return "";
  return c.replace(/^cat_/, "").replace(/_/g, " ");
}

function montar(nome: string, prof: string) {
  const primeiro = esc((nome || "").trim().split(/\s+/)[0] || "profissional");
  const servico = prof ? "serviço de " + esc(prof) : "serviços como o seu";
  const assunto = `Tem cliente esperando por você, ${(nome || "").trim().split(/\s+/)[0] || "profissional"}`;
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F5F6FA;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">Falta um toque para os pedidos chegarem no seu celular.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
<tr><td style="background:#07162F;padding:18px;text-align:center;border-bottom:3px solid #FF7900;border-radius:10px 10px 0 0;"><span style="color:#fff;font-size:22px;font-weight:bold;">QuemFaz</span></td></tr>
<tr><td style="background:#fff;padding:24px 20px;">
<p style="margin:0 0 12px;font-size:20px;font-weight:bold;color:#07162F;">${primeiro}, tem gente precisando de você</p>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#3d3d3a;">Todos os dias, clientes da sua região pedem ${servico} no QuemFaz. Você está cadastrado, mas o seu celular ainda não avisa quando um pedido chega.</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3d3d3a;">Cada pedido que passa sem você ver é uma oportunidade que vai para outro profissional. Dá para mudar isso em 10 segundos.</p>
<p style="text-align:center;margin:0 0 12px;"><a href="${LINK}" style="display:inline-block;background:#FF7900;color:#fff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 26px;border-radius:8px;">Ativar notificações</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b66;text-align:center;">Abra o link no celular, entre na sua conta e toque em permitir.</p>
</td></tr>
<tr><td style="background:#fff;padding:0 20px 24px;text-align:center;font-size:15px;line-height:1.5;color:#07162F;">De coração, obrigado por fazer parte.<br><b>Quem Faz</b></td></tr>
<tr><td style="background:#07162F;padding:12px;text-align:center;font-size:11px;color:#b9c2d3;border-radius:0 0 10px 10px;">Instagram @quem.fazservico · quemfazservico.com.br</td></tr>
</table></td></tr></table></body></html>`;
  const texto = `${primeiro}, tem gente precisando de você.\n\nTodos os dias, clientes da sua região pedem ${prof ? "serviço de " + prof : "serviços como o seu"} no QuemFaz. Você está cadastrado, mas o seu celular ainda não avisa quando um pedido chega.\n\nAtive as notificações em 10 segundos: ${LINK}\n\nDe coração, obrigado por fazer parte.\nQuem Faz`;
  return { assunto, html, texto };
}

async function enviar(from: string, to: string, nome: string, prof: string) {
  const m = montar(nome, prof);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: m.assunto, html: m.html, text: m.texto }),
  });
  const out = await r.json().catch(() => ({}));
  return { ok: r.ok, id: out?.id || null, erro: r.ok ? null : String(out?.message || out?.name || r.status).slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = String(req.headers.get("x-qf-internal") || "");
  if (secret.length < 32) return json({ error: "unauthorized" }, 401);
  const { data: okSecret } = await admin.rpc("qf_push_internal_ok", { p_segredo: secret });
  if (okSecret !== true) return json({ error: "unauthorized" }, 401);
  if (!RESEND_KEY) return json({ error: "resend_key_missing" }, 500);

  const body = await req.json().catch(() => ({}));

  if (body.teste_para) {
    const r = await enviar(FROM_TESTE, String(body.teste_para), "Carlos", "pedreiro");
    return json({ modo: "teste", ...r });
  }

  const ids: string[] = Array.isArray(body.user_ids) ? body.user_ids.slice(0, 200) : [];
  const resumo = { enviados: 0, falhas: 0, ja_enviados: 0, sem_email: 0 };
  for (const uid of ids) {
    const { data: reg } = await admin.from("qf_email_ativacao").insert({ user_id: uid, status: "enviando" }).select("user_id").maybeSingle();
    if (!reg) { resumo.ja_enviados++; continue; }
    const { data: u } = await admin.auth.admin.getUserById(uid);
    const email = u?.user?.email || "";
    if (!email) { resumo.sem_email++; await admin.from("qf_email_ativacao").update({ status: "sem_email" }).eq("user_id", uid); continue; }
    const { data: p } = await admin.from("qf_profissionais").select("nome,especialidades").eq("user_id", uid).maybeSingle();
    const r = await enviar(FROM_PROD, email, p?.nome || "", profissao(p?.especialidades || null));
    await admin.from("qf_email_ativacao").update({ email, status: r.ok ? "enviado" : "falhou", erro: r.erro, resend_id: r.id, enviado_em: r.ok ? new Date().toISOString() : null }).eq("user_id", uid);
    r.ok ? resumo.enviados++ : resumo.falhas++;
    await new Promise((res) => setTimeout(res, 600));
  }
  return json({ ok: true, ...resumo });
});
