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

function bearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ ok: false, error: "Método não permitido." }, 405);

  const token = bearer(req);
  if (!token) return reply({ ok: false, error: "Sua sessão expirou. Entre novamente." }, 401);

  // V11.14.38: valida a sessão diretamente no Supabase Auth.
  // O wrapper anterior rejeitava sessões válidas e devolvia 401 no momento de trocar a senha.
  const auth = await admin.auth.getUser(token);
  const caller = auth.data?.user || null;
  if (auth.error || !caller) {
    return reply({ ok: false, error: "Sua sessão expirou. Entre novamente." }, 401);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || "");
  const password = String(body.password || "");

  if (password.length < 6) {
    return reply({ ok: false, error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
  }

  if (action === "admin_set_temp") {
    const adminCheck = await admin
      .from("qf_admins")
      .select("user_id")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (adminCheck.error || !adminCheck.data) {
      return reply({ ok: false, error: "Acesso de administrador necessário." }, 403);
    }

    const targetUserId = String(body.user_id || "");
    if (!targetUserId) return reply({ ok: false, error: "Usuário não informado." }, 400);

    const current = await admin.auth.admin.getUserById(targetUserId);
    if (current.error || !current.data.user) {
      return reply({ ok: false, error: "Usuário não encontrado." }, 404);
    }

    const appMetadata = {
      ...(current.data.user.app_metadata || {}),
      qf_force_password_change: true,
      qf_password_changed_by_admin_at: new Date().toISOString(),
    };

    const changed = await admin.auth.admin.updateUserById(targetUserId, {
      password,
      app_metadata: appMetadata,
    });

    if (changed.error) {
      console.error("admin_set_temp", changed.error.message);
      return reply({ ok: false, error: "Não foi possível alterar a senha temporária." }, 400);
    }

    return reply({ ok: true, force_password_change: true });
  }

  if (action === "self_change") {
    const current = await admin.auth.admin.getUserById(caller.id);
    if (current.error || !current.data.user) {
      return reply({ ok: false, error: "Usuário não encontrado." }, 404);
    }

    const appMetadata = {
      ...(current.data.user.app_metadata || {}),
      qf_force_password_change: false,
      qf_password_changed_at: new Date().toISOString(),
    };

    const changed = await admin.auth.admin.updateUserById(caller.id, {
      password,
      app_metadata: appMetadata,
    });

    if (changed.error) {
      console.error("self_change", changed.error.message);
      return reply({ ok: false, error: "Não foi possível salvar sua nova senha." }, 400);
    }

    return reply({
      ok: true,
      user_id: caller.id,
      email: caller.email || null,
      force_password_change: false,
    });
  }

  return reply({ ok: false, error: "Ação inválida." }, 400);
});
