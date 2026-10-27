// Pedido Fácil — conta do cliente: telefone + senha, e-mail verificado, recuperação por e-mail.
// Sem SMS e sem OTP telefônico. Senhas ficam em hash (bcrypt) no Supabase Auth; nunca em texto puro.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SITE = "https://quemfazservico.com.br";
const FROM = "Quem Faz <avisos@quemfazservico.com.br>";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

// ---------- utilidades ----------
const DDDS = new Set("11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99".split(" "));
function normalizePhone(v: unknown) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d;
}
function validMobile(d: string) {
  if (d.length !== 11 || !DDDS.has(d.slice(0, 2)) || d[2] !== "9") return false;
  const resto = d.slice(3);
  if (resto === "12345678" || resto === "87654321") return false;
  return new Set(resto.split("")).size >= 3;
}
const isInternalEmail = (e: string) => /@acesso\.quemfaz\.app\.br$/i.test(e);
const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 160 && !isInternalEmail(e);
function validPassword(s: string) {
  return s.length >= 6 && s.length <= 72;
}
const PASS_MSG = "Escolha uma senha com pelo menos 6 posições. Pode usar somente números ou somente letras.";
async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function clientIpHash(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "sem-ip";
  return (await sha256("ip:" + ip + ":" + SERVICE_ROLE.slice(-12))).slice(0, 32);
}

async function logEvent(evento: string, ok: boolean, o: { userId?: string | null; telefone?: string; ipHash?: string; detalhe?: string; chave?: string } = {}) {
  try {
    await admin.from("qf_cliente_auth_eventos").insert({
      evento, ok,
      user_id: o.userId || null,
      telefone_fim: o.telefone ? o.telefone.slice(-4) : null,
      ip_hash: o.ipHash || null,
      chave_hash: o.chave || null,
      detalhe: o.detalhe ? String(o.detalhe).slice(0, 200) : null,
    });
  } catch (e) { console.error("log_evento", (e as Error).message); }
}

// Conta eventos recentes (falhas ou todos) por chave, para limitar tentativas.
async function recentCount(evento: string, campo: "chave_hash" | "ip_hash", valor: string, minutos: number, soFalhas: boolean) {
  const since = new Date(Date.now() - minutos * 60000).toISOString();
  let q = admin.from("qf_cliente_auth_eventos").select("id", { count: "exact", head: true })
    .eq("evento", evento).eq(campo, valor).gte("criado_em", since);
  if (soFalhas) q = q.eq("ok", false);
  const { count } = await q;
  return count || 0;
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (!RESEND_KEY) return { ok: false, erro: "resend_key_missing" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: String(out?.message || out?.name || r.status).slice(0, 200) };
    return { ok: true, erro: null };
  } catch (e) { return { ok: false, erro: (e as Error).message }; }
}

function emailLayout(titulo: string, corpo: string, botao: string, link: string, rodape: string) {
  const html = `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F5F6FA;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px;">
<table role="presentation" width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">
<tr><td style="background:#07162F;padding:18px;text-align:center;border-bottom:3px solid #FF7900;border-radius:10px 10px 0 0;"><span style="color:#fff;font-size:22px;font-weight:bold;">QuemFaz</span></td></tr>
<tr><td style="background:#fff;padding:24px 20px;">
<p style="margin:0 0 12px;font-size:20px;font-weight:bold;color:#07162F;">${esc(titulo)}</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#3d3d3a;">${corpo}</p>
<p style="text-align:center;margin:0 0 14px;"><a href="${link}" style="display:inline-block;background:#FF7900;color:#fff;font-size:16px;font-weight:bold;text-decoration:none;padding:14px 26px;border-radius:8px;">${esc(botao)}</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#6b6b66;text-align:center;">${rodape}</p>
</td></tr>
<tr><td style="background:#fff;padding:0 20px 24px;text-align:center;font-size:15px;line-height:1.5;color:#07162F;">De coração, obrigado.<br><b>Quem Faz</b></td></tr>
<tr><td style="background:#07162F;padding:12px;text-align:center;font-size:11px;color:#b9c2d3;border-radius:0 0 10px 10px;">Instagram @quem.fazservico · quemfazservico.com.br</td></tr>
</table></td></tr></table></body></html>`;
  return html;
}

async function emitirToken(userId: string, email: string, finalidade: "verificar_email" | "recuperar_senha", horas: number) {
  const token = newToken();
  const hash = await sha256(token);
  const { error } = await admin.from("qf_cliente_tokens").insert({
    user_id: userId, finalidade, token_hash: hash, email,
    expira_em: new Date(Date.now() + horas * 3600000).toISOString(),
  });
  if (error) { console.error("token_insert", error.message); return null; }
  return token;
}

async function enviarVerificacao(userId: string, email: string, nome: string) {
  const token = await emitirToken(userId, email, "verificar_email", 48);
  if (!token) return { ok: false };
  const link = `${SITE}/#/auth/cliente/verificar/${token}`;
  const primeiro = (nome || "").trim().split(/\s+/)[0] || "";
  const html = emailLayout(
    `Confirme seu e-mail${primeiro ? ", " + primeiro : ""}`,
    "Para proteger sua conta e poder recuperar sua senha depois, confirme que este e-mail é seu. É só tocar no botão abaixo.",
    "Confirmar meu e-mail", link,
    "Se você não criou uma conta no QuemFaz, ignore este e-mail. O link vale por 48 horas.");
  const texto = `Confirme seu e-mail no QuemFaz: ${link}\n\nSe você não criou uma conta, ignore esta mensagem. O link vale por 48 horas.\n\nQuem Faz`;
  const r = await sendEmail(email, "Confirme seu e-mail no QuemFaz", html, texto);
  if (!r.ok) console.error("email_verificacao", r.erro);
  return r;
}

// Sessão real do Supabase Auth, obtida validando a senha (hash conferido pelo GoTrue).
async function abrirSessao(email: string, senha: string) {
  const c = anon();
  const r = await c.auth.signInWithPassword({ email, password: senha });
  if (r.error || !r.data.session) return null;
  const s = r.data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in };
}

async function usuarioDoJwt(req: Request) {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}

async function clientePorTelefone(telefone: string) {
  const r = await admin.rpc("qf_cliente_canonico_por_whatsapp", { p_whatsapp: telefone });
  if (r.error) throw new Error("canonico:" + r.error.message);
  return Array.isArray(r.data) && r.data.length ? r.data[0] : null;
}

async function estadoConta(userId: string) {
  const { data } = await admin.from("qf_cliente_contas").select("*").eq("user_id", userId).maybeSingle();
  return data as null | { email_verificado_em: string | null; senha_definida_em: string | null; email: string | null };
}

const ERRO_LOGIN = "Telefone ou senha incorretos. Se você já fez pedidos antes e ainda não criou senha, use “Primeiro acesso”.";

// ---------- ações ----------
async function cadastrar(req: Request, b: any, ipHash: string) {
  const nome = String(b.nome || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const telefone = normalizePhone(b.telefone);
  const email = String(b.email || "").trim().toLowerCase();
  const senha = String(b.senha || "");
  if (nome.length < 2) return reply({ ok: false, error: "Informe seu nome." }, 400);
  if (!validMobile(telefone)) return reply({ ok: false, error: "Esse número não parece um celular válido. Digite o seu WhatsApp com DDD e o 9 na frente.", campo: "telefone" }, 400);
  if (!validEmail(email)) return reply({ ok: false, error: "Digite um e-mail válido.", campo: "email" }, 400);
  if (!validPassword(senha)) return reply({ ok: false, error: PASS_MSG, campo: "senha" }, 400);

  if (await recentCount("cadastro", "ip_hash", ipHash, 60, false) >= 15) {
    return reply({ ok: false, error: "Muitas tentativas. Aguarde um pouco e tente de novo." }, 429);
  }

  const existente = await clientePorTelefone(telefone);
  if (existente) {
    const st = await estadoConta(String(existente.id));
    await logEvent("cadastro", false, { telefone, ipHash, detalhe: "telefone_ja_cadastrado" });
    if (st && st.senha_definida_em) {
      return reply({ ok: false, codigo: "telefone_cadastrado", error: "Este telefone já tem conta. Entre com sua senha, ou toque em “Esqueci minha senha”.", campo: "telefone" }, 409);
    }
    return reply({ ok: false, codigo: "telefone_legado", error: "Este telefone já fez pedidos antes. Use “Primeiro acesso” para criar sua senha e manter seus pedidos.", campo: "telefone" }, 409);
  }

  const created = await admin.auth.admin.createUser({
    email, password: senha, email_confirm: true,
    user_metadata: { qf_role: "cliente", qf_nome: nome, qf_telefone: telefone, qf_pedido_facil: true },
  });
  if (created.error || !created.data.user) {
    const msg = String(created.error?.message || "");
    await logEvent("cadastro", false, { telefone, ipHash, detalhe: "criar:" + msg.slice(0, 80) });
    if (/already|registered|exists|duplicate/i.test(msg)) {
      if (/telefone|qf_profiles/i.test(msg)) return reply({ ok: false, codigo: "telefone_cadastrado", error: "Este telefone já tem conta. Entre com sua senha.", campo: "telefone" }, 409);
      return reply({ ok: false, codigo: "email_cadastrado", error: "Este e-mail já está em uso. Entre com sua conta ou use outro e-mail.", campo: "email" }, 409);
    }
    return reply({ ok: false, error: "Não foi possível criar sua conta agora. Tente novamente." }, 500);
  }
  const user = created.data.user;

  const prof = await admin.from("qf_profiles").upsert({
    id: user.id, tipo: "cliente", nome, telefone, whatsapp: telefone, ativo: true, atualizado_em: new Date().toISOString(),
  }, { onConflict: "id" });
  if (prof.error) {
    console.error("perfil", prof.error.message);
    await admin.auth.admin.deleteUser(user.id).catch(() => null);
    await logEvent("cadastro", false, { telefone, ipHash, detalhe: "perfil:" + prof.error.message.slice(0, 80) });
    const dup = /unique|duplicate/i.test(prof.error.message);
    return reply({ ok: false, codigo: dup ? "telefone_cadastrado" : undefined, error: dup ? "Este telefone já tem conta. Entre com sua senha." : "Não foi possível concluir seu cadastro agora." }, dup ? 409 : 500);
  }
  await admin.from("qf_cliente_contas").upsert({
    user_id: user.id, email, senha_definida_em: new Date().toISOString(), origem: "pedido_facil", atualizado_em: new Date().toISOString(),
  }, { onConflict: "user_id" });

  const sessao = await abrirSessao(email, senha);
  if (!sessao) {
    await logEvent("cadastro", false, { userId: user.id, telefone, ipHash, detalhe: "sessao" });
    return reply({ ok: false, error: "Conta criada, mas não foi possível entrar agora. Use Entrar com telefone e senha." }, 500);
  }
  const envio = await enviarVerificacao(user.id, email, nome);
  await logEvent("cadastro", true, { userId: user.id, telefone, ipHash, detalhe: envio.ok ? "email_enviado" : "email_falhou" });
  return reply({ ok: true, user_id: user.id, session: sessao, email_enviado: !!envio.ok, email_verificado: false });
}

async function entrar(b: any, ipHash: string) {
  const telefone = normalizePhone(b.telefone);
  const senha = String(b.senha || "");
  if (!validMobile(telefone)) return reply({ ok: false, error: "Esse número não parece um celular válido. Digite o seu WhatsApp com DDD e o 9 na frente.", campo: "telefone" }, 400);
  if (!senha) return reply({ ok: false, error: "Digite sua senha.", campo: "senha" }, 400);
  const chave = (await sha256("tel:" + telefone)).slice(0, 32);
  if (await recentCount("entrar", "chave_hash", chave, 15, true) >= 5 || await recentCount("entrar", "ip_hash", ipHash, 15, true) >= 30) {
    await logEvent("entrar", false, { telefone, ipHash, chave, detalhe: "bloqueado" });
    return reply({ ok: false, error: "Muitas tentativas. Espere 15 minutos e tente de novo." }, 429);
  }
  const cli = await clientePorTelefone(telefone);
  const st = cli ? await estadoConta(String(cli.id)) : null;
  if (!cli || !st || !st.senha_definida_em) {
    await logEvent("entrar", false, { telefone, ipHash, chave, detalhe: cli ? "sem_senha" : "sem_conta" });
    return reply({ ok: false, error: ERRO_LOGIN }, 401);
  }
  const u = await admin.auth.admin.getUserById(String(cli.id));
  const email = String(u.data.user?.email || "");
  const sessao = email ? await abrirSessao(email, senha) : null;
  if (!sessao) {
    await logEvent("entrar", false, { userId: String(cli.id), telefone, ipHash, chave, detalhe: "senha_incorreta" });
    return reply({ ok: false, error: ERRO_LOGIN }, 401);
  }
  await logEvent("entrar", true, { userId: String(cli.id), telefone, ipHash, chave });
  return reply({ ok: true, user_id: String(cli.id), session: sessao, email_verificado: !!st.email_verificado_em });
}

async function verificarEmail(b: any, ipHash: string) {
  const token = String(b.token || "").trim();
  if (token.length < 20 || token.length > 100) return reply({ ok: false, error: "Link inválido." }, 400);
  if (await recentCount("verificar_email", "ip_hash", ipHash, 15, true) >= 20) return reply({ ok: false, error: "Muitas tentativas. Aguarde um pouco." }, 429);
  const hash = await sha256(token);
  const { data: t } = await admin.from("qf_cliente_tokens").select("*").eq("token_hash", hash).eq("finalidade", "verificar_email").maybeSingle();
  if (!t || t.usado_em || new Date(t.expira_em).getTime() < Date.now()) {
    await logEvent("verificar_email", false, { ipHash, detalhe: !t ? "inexistente" : t.usado_em ? "usado" : "expirado" });
    return reply({ ok: false, codigo: "link_invalido", error: "Este link expirou ou já foi usado. Peça um novo link dentro da sua conta." }, 400);
  }
  const u = await admin.auth.admin.getUserById(t.user_id);
  const emailAtual = String(u.data.user?.email || "").toLowerCase();
  if (!emailAtual || emailAtual !== String(t.email).toLowerCase()) {
    await logEvent("verificar_email", false, { userId: t.user_id, ipHash, detalhe: "email_mudou" });
    return reply({ ok: false, codigo: "link_invalido", error: "Este link não vale mais para o e-mail atual da conta." }, 400);
  }
  await admin.from("qf_cliente_tokens").update({ usado_em: new Date().toISOString() }).eq("id", t.id);
  await admin.from("qf_cliente_contas").update({ email_verificado_em: new Date().toISOString(), email: emailAtual, atualizado_em: new Date().toISOString() }).eq("user_id", t.user_id);
  await logEvent("verificar_email", true, { userId: t.user_id, ipHash });
  return reply({ ok: true });
}

async function reenviar(req: Request, ipHash: string) {
  const user = await usuarioDoJwt(req);
  if (!user) return reply({ ok: false, error: "Entre na sua conta para reenviar o e-mail." }, 401);
  const st = await estadoConta(user.id);
  if (!st) return reply({ ok: false, error: "Sua conta ainda não tem e-mail para confirmar." }, 400);
  if (st.email_verificado_em) return reply({ ok: true, ja_verificado: true });
  const email = String(user.email || "").toLowerCase();
  if (!validEmail(email)) return reply({ ok: false, error: "Cadastre um e-mail válido primeiro." }, 400);
  const chave = (await sha256("reenviar:" + user.id)).slice(0, 32);
  if (await recentCount("reenviar", "chave_hash", chave, 60, false) >= 3) return reply({ ok: false, error: "Você já pediu o e-mail 3 vezes. Aguarde uma hora e confira o spam." }, 429);
  const { data: p } = await admin.from("qf_profiles").select("nome").eq("id", user.id).maybeSingle();
  const r = await enviarVerificacao(user.id, email, p?.nome || "");
  await logEvent("reenviar", !!r.ok, { userId: user.id, ipHash, chave, detalhe: r.ok ? "enviado" : "falhou" });
  return reply({ ok: !!r.ok, error: r.ok ? undefined : "Não foi possível enviar o e-mail agora. Tente de novo em instantes." }, r.ok ? 200 : 502);
}

async function esqueciSenha(b: any, ipHash: string) {
  const email = String(b.email || "").trim().toLowerCase();
  const generica = reply({ ok: true, mensagem: "Se este e-mail estiver cadastrado e verificado, enviamos o link para criar uma nova senha. Confira também o spam." });
  if (!validEmail(email)) return reply({ ok: false, error: "Digite um e-mail válido.", campo: "email" }, 400);
  const chave = (await sha256("esqueci:" + email)).slice(0, 32);
  if (await recentCount("esqueci", "chave_hash", chave, 60, false) >= 3 || await recentCount("esqueci", "ip_hash", ipHash, 60, false) >= 10) {
    return generica; // não revela limite nem existência
  }
  const { data: conta } = await admin.from("qf_cliente_contas").select("user_id,email,email_verificado_em").eq("email", email).not("email_verificado_em", "is", null).maybeSingle();
  if (!conta) { await logEvent("esqueci", false, { ipHash, chave, detalhe: "email_sem_conta_verificada" }); return generica; }
  const u = await admin.auth.admin.getUserById(conta.user_id);
  if (String(u.data.user?.email || "").toLowerCase() !== email) { await logEvent("esqueci", false, { userId: conta.user_id, ipHash, chave, detalhe: "email_mudou" }); return generica; }
  const token = await emitirToken(conta.user_id, email, "recuperar_senha", 1);
  if (!token) return generica;
  const link = `${SITE}/#/auth/cliente/redefinir/${token}`;
  const html = emailLayout("Criar uma nova senha",
    "Recebemos um pedido para criar uma nova senha da sua conta no QuemFaz. Toque no botão abaixo para escolher a nova senha. O link vale por 1 hora.",
    "Criar nova senha", link, "Se não foi você, ignore este e-mail: sua senha atual continua valendo.");
  const r = await sendEmail(email, "Crie uma nova senha no QuemFaz", html, `Crie uma nova senha no QuemFaz: ${link}\n\nO link vale por 1 hora. Se não foi você, ignore.\n\nQuem Faz`);
  await logEvent("esqueci", !!r.ok, { userId: conta.user_id, ipHash, chave, detalhe: r.ok ? "enviado" : "falhou:" + (r.erro || "") });
  return generica;
}

async function redefinirSenha(b: any, ipHash: string) {
  const token = String(b.token || "").trim();
  const senha = String(b.senha || "");
  if (token.length < 20 || token.length > 100) return reply({ ok: false, error: "Link inválido." }, 400);
  if (!validPassword(senha)) return reply({ ok: false, error: PASS_MSG, campo: "senha" }, 400);
  if (await recentCount("redefinir", "ip_hash", ipHash, 15, true) >= 20) return reply({ ok: false, error: "Muitas tentativas. Aguarde um pouco." }, 429);
  const hash = await sha256(token);
  const { data: t } = await admin.from("qf_cliente_tokens").select("*").eq("token_hash", hash).eq("finalidade", "recuperar_senha").maybeSingle();
  if (!t || t.usado_em || new Date(t.expira_em).getTime() < Date.now()) {
    await logEvent("redefinir", false, { ipHash, detalhe: !t ? "inexistente" : t.usado_em ? "usado" : "expirado" });
    return reply({ ok: false, codigo: "link_invalido", error: "Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”." }, 400);
  }
  const conta = await estadoConta(t.user_id);
  const u = await admin.auth.admin.getUserById(t.user_id);
  const emailAtual = String(u.data.user?.email || "").toLowerCase();
  if (!conta || !conta.email_verificado_em || emailAtual !== String(t.email).toLowerCase()) {
    await logEvent("redefinir", false, { userId: t.user_id, ipHash, detalhe: "conta_nao_elegivel" });
    return reply({ ok: false, codigo: "link_invalido", error: "Este link não vale mais para esta conta." }, 400);
  }
  const upd = await admin.auth.admin.updateUserById(t.user_id, { password: senha });
  if (upd.error) {
    await logEvent("redefinir", false, { userId: t.user_id, ipHash, detalhe: "update:" + upd.error.message.slice(0, 80) });
    return reply({ ok: false, error: "Não foi possível salvar a nova senha agora. Tente de novo." }, 500);
  }
  const agora = new Date().toISOString();
  await admin.from("qf_cliente_tokens").update({ usado_em: agora }).eq("user_id", t.user_id).eq("finalidade", "recuperar_senha").is("usado_em", null);
  await admin.from("qf_cliente_contas").update({ senha_definida_em: agora, atualizado_em: agora }).eq("user_id", t.user_id);
  await logEvent("redefinir", true, { userId: t.user_id, ipHash });
  return reply({ ok: true });
}

// Vincula conta antiga (acesso rápido) a e-mail real + senha. Prova de posse: código antigo OU sessão ativa.
async function vincular(req: Request, b: any, ipHash: string, modo: "codigo" | "sessao") {
  const email = String(b.email || "").trim().toLowerCase();
  const senha = String(b.senha || "");
  if (!validEmail(email)) return reply({ ok: false, error: "Digite um e-mail válido.", campo: "email" }, 400);
  if (!validPassword(senha)) return reply({ ok: false, error: PASS_MSG, campo: "senha" }, 400);

  let userId = "";
  let telefone = "";
  const evento = modo === "codigo" ? "primeiro_acesso" : "proteger_conta";
  if (modo === "sessao") {
    const u = await usuarioDoJwt(req);
    if (!u) return reply({ ok: false, error: "Sua sessão expirou. Use o primeiro acesso com o código." }, 401);
    const { data: p } = await admin.from("qf_profiles").select("id,tipo,telefone,whatsapp").eq("id", u.id).maybeSingle();
    if (!p || p.tipo !== "cliente") return reply({ ok: false, error: "Esta conta não é de cliente." }, 403);
    userId = u.id; telefone = normalizePhone(p.whatsapp || p.telefone);
  } else {
    telefone = normalizePhone(b.telefone);
    const codigo = String(b.codigo || "").replace(/\D/g, "");
    if (!validMobile(telefone)) return reply({ ok: false, error: "Esse número não parece um celular válido.", campo: "telefone" }, 400);
    if (codigo.length !== 6) return reply({ ok: false, error: "Digite o código de acesso de 6 números.", campo: "codigo" }, 400);
    const cli = await clientePorTelefone(telefone);
    const ERRO = "WhatsApp ou código incorreto. Confira os dois e tente de novo.";
    if (!cli) { await logEvent(evento, false, { telefone, ipHash, detalhe: "sem_conta" }); return reply({ ok: false, error: ERRO }, 401); }
    const conf = await admin.rpc("qf_conferir_codigo_acesso", { p_cliente: String(cli.id), p_codigo: codigo });
    if (conf.error) return reply({ ok: false, error: "Não foi possível conferir seu código agora." }, 500);
    if (conf.data === "bloqueado") return reply({ ok: false, error: "Muitas tentativas. Espere 15 minutos e tente de novo." }, 429);
    if (conf.data !== "ok") { await logEvent(evento, false, { userId: String(cli.id), telefone, ipHash, detalhe: "codigo_errado" }); return reply({ ok: false, error: ERRO }, 401); }
    userId = String(cli.id);
  }

  const st = await estadoConta(userId);
  if (st && st.senha_definida_em) {
    return reply({ ok: false, codigo: "ja_tem_senha", error: "Esta conta já tem senha. Entre com telefone e senha, ou use “Esqueci minha senha”." }, 409);
  }
  const cur = await admin.auth.admin.getUserById(userId);
  if (cur.error || !cur.data.user) return reply({ ok: false, error: "Não foi possível recuperar sua conta agora." }, 500);
  const upd = await admin.auth.admin.updateUserById(userId, { email, password: senha, email_confirm: true });
  if (upd.error) {
    const dup = /already|registered|exists|duplicate/i.test(upd.error.message);
    await logEvent(evento, false, { userId, telefone, ipHash, detalhe: "update:" + upd.error.message.slice(0, 80) });
    return reply({ ok: false, codigo: dup ? "email_cadastrado" : undefined, error: dup ? "Este e-mail já está em uso em outra conta. Use outro e-mail." : "Não foi possível atualizar sua conta agora.", campo: dup ? "email" : undefined }, dup ? 409 : 500);
  }
  const agora = new Date().toISOString();
  await admin.from("qf_cliente_contas").upsert({
    user_id: userId, email, email_verificado_em: null, senha_definida_em: agora, origem: "legado_migrado", atualizado_em: agora,
  }, { onConflict: "user_id" });
  await admin.from("qf_cliente_tokens").update({ usado_em: agora }).eq("user_id", userId).is("usado_em", null);
  const { data: p } = await admin.from("qf_profiles").select("nome").eq("id", userId).maybeSingle();
  const sessao = await abrirSessao(email, senha);
  const envio = await enviarVerificacao(userId, email, p?.nome || "");
  await logEvent(evento, true, { userId, telefone, ipHash, detalhe: envio.ok ? "email_enviado" : "email_falhou" });
  if (!sessao) return reply({ ok: false, error: "Senha criada. Entre com telefone e senha." }, 500);
  return reply({ ok: true, user_id: userId, session: sessao, email_enviado: !!envio.ok, email_verificado: false });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, error: "Método não permitido." }, 405);
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const acao = String(b.acao || "");
  const ipHash = await clientIpHash(req);
  try {
    switch (acao) {
      case "cadastrar": return await cadastrar(req, b, ipHash);
      case "entrar": return await entrar(b, ipHash);
      case "verificar_email": return await verificarEmail(b, ipHash);
      case "reenviar_verificacao": return await reenviar(req, ipHash);
      case "esqueci_senha": return await esqueciSenha(b, ipHash);
      case "redefinir_senha": return await redefinirSenha(b, ipHash);
      case "primeiro_acesso": return await vincular(req, b, ipHash, "codigo");
      case "proteger_conta": return await vincular(req, b, ipHash, "sessao");
      default: return reply({ ok: false, error: "Ação inválida." }, 400);
    }
  } catch (e) {
    console.error("conta_erro", acao, (e as Error).message);
    await logEvent(acao || "desconhecida", false, { ipHash, detalhe: "excecao:" + (e as Error).message.slice(0, 120) });
    return reply({ ok: false, error: "Não foi possível concluir agora. Tente novamente." }, 500);
  }
});
