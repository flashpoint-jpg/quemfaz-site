import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizePhone(value: unknown) {
  let d = String(value || "").replace(/\D/g, "");
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d;
}

function isInternalEmail(email: string) {
  return /@acesso\.quemfaz\.app\.br$/i.test(email);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, error: "Método não permitido." }, 405);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const nome = String(body.nome || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const telefone = normalizePhone(body.telefone);

  if (nome.length < 2) return reply({ ok: false, error: "Informe seu nome." }, 400);
  if (!(telefone.length === 10 || telefone.length === 11)) {
    return reply({ ok: false, error: "Informe seu WhatsApp/celular com DDD." }, 400);
  }

  const canonical = await admin.rpc("qf_cliente_canonico_por_whatsapp", { p_whatsapp: telefone });
  if (canonical.error) {
    console.error("cliente_canônico", canonical.error.message);
    return reply({ ok: false, error: "Não foi possível localizar seu acesso agora." }, 500);
  }

  const found = Array.isArray(canonical.data) && canonical.data.length ? canonical.data[0] : null;
  let userId = found ? String(found.id) : "";
  let authUser: any = null;

  if (userId) {
    const current = await admin.auth.admin.getUserById(userId);
    if (current.error || !current.data.user) {
      console.error("auth_usuario_existente", current.error?.message || "sem usuário");
      return reply({ ok: false, error: "Não foi possível recuperar seu acesso agora." }, 500);
    }
    authUser = current.data.user;

    let email = String(authUser.email || "").trim().toLowerCase();
    const metadata = {
      ...(authUser.user_metadata || {}),
      qf_role: "cliente",
      qf_nome: nome,
      qf_telefone: telefone,
      qf_quick_client: true,
    };

    const changes: Record<string, unknown> = { user_metadata: metadata };
    if (!email) {
      email = `cliente-${telefone}@acesso.quemfaz.app.br`;
      changes.email = email;
      changes.email_confirm = true;
    }

    const changed = await admin.auth.admin.updateUserById(userId, changes);
    if (changed.error || !changed.data.user) {
      console.error("auth_atualizar", changed.error?.message || "sem usuário");
      return reply({ ok: false, error: "Não foi possível atualizar seu acesso agora." }, 500);
    }
    authUser = changed.data.user;

    const upd = await admin.from("qf_profiles").update({
      nome,
      telefone,
      whatsapp: telefone,
      ativo: true,
      atualizado_em: new Date().toISOString(),
    }).eq("id", userId);
    if (upd.error) {
      console.error("perfil_atualizar", upd.error.message);
      return reply({ ok: false, error: "Não foi possível atualizar seu cadastro agora." }, 500);
    }
  } else {
    const email = `cliente-${telefone}@acesso.quemfaz.app.br`;
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        qf_role: "cliente",
        qf_nome: nome,
        qf_telefone: telefone,
        qf_quick_client: true,
      },
    });

    if (created.error || !created.data.user) {
      console.error("auth_criar", created.error?.message || "sem usuário");
      return reply({ ok: false, error: "Não foi possível criar seu acesso agora. Tente novamente." }, 500);
    }

    authUser = created.data.user;
    userId = authUser.id;

    const profile = await admin.from("qf_profiles").upsert({
      id: userId,
      tipo: "cliente",
      nome,
      telefone,
      whatsapp: telefone,
      ativo: true,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "id" });
    if (profile.error) {
      console.error("perfil_criar", profile.error.message);
      await admin.auth.admin.deleteUser(userId).catch(() => null);
      return reply({ ok: false, error: "Não foi possível concluir seu cadastro agora." }, 500);
    }
  }

  const email = String(authUser?.email || "").trim().toLowerCase();
  if (!email) return reply({ ok: false, error: "Não foi possível preparar seu acesso." }, 500);

  const generated = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (generated.error || !generated.data) {
    console.error("magiclink", generated.error?.message || "sem dados");
    return reply({ ok: false, error: "Não foi possível abrir seu acesso agora." }, 500);
  }

  const props: any = generated.data.properties || {};
  let tokenHash = String(props.hashed_token || "");
  let otpType = "magiclink";
  if (!tokenHash && props.action_link) {
    try {
      const u = new URL(String(props.action_link));
      tokenHash = u.searchParams.get("token_hash") || "";
      otpType = u.searchParams.get("type") || otpType;
    } catch (_) {}
  }

  if (!tokenHash) {
    console.error("magiclink sem token", { userId, hasAction: !!props.action_link });
    return reply({ ok: false, error: "Não foi possível validar seu acesso agora." }, 500);
  }

  return reply({
    ok: true,
    user_id: userId,
    token_hash: tokenHash,
    otp_type: otpType,
    reused: !!found,
    internal_email: isInternalEmail(email),
  });
});
