import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server";

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method !== "POST") return reply({ ok: false, error: "Método não permitido." }, 405);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || "");
    const password = String(body.password || "");

    if (password.length < 6) {
      return reply({ ok: false, error: "A senha precisa ter pelo menos 6 caracteres." }, 400);
    }

    if (action === "admin_set_temp") {
      const adminCheck = await ctx.supabase.rpc("qf_admin_config_anuncios");
      if (adminCheck.error) {
        return reply({ ok: false, error: "Acesso de administrador necessário." }, 403);
      }

      const targetUserId = String(body.user_id || "");
      if (!targetUserId) return reply({ ok: false, error: "Cliente não informado." }, 400);

      const current = await ctx.supabaseAdmin.auth.admin.getUserById(targetUserId);
      if (current.error || !current.data.user) {
        return reply({ ok: false, error: "Cliente não encontrado." }, 404);
      }

      const appMetadata = {
        ...(current.data.user.app_metadata || {}),
        qf_force_password_change: true,
        qf_password_changed_by_admin_at: new Date().toISOString(),
      };

      const changed = await ctx.supabaseAdmin.auth.admin.updateUserById(targetUserId, {
        password,
        app_metadata: appMetadata,
      });

      if (changed.error) {
        return reply({ ok: false, error: "Não foi possível alterar a senha do cliente." }, 400);
      }
      return reply({ ok: true, force_password_change: true });
    }

    if (action === "self_change") {
      const userId = String(ctx.userClaims?.sub || "");
      if (!userId) return reply({ ok: false, error: "Sessão inválida." }, 401);

      const current = await ctx.supabaseAdmin.auth.admin.getUserById(userId);
      if (current.error || !current.data.user) {
        return reply({ ok: false, error: "Usuário não encontrado." }, 404);
      }

      const appMetadata = {
        ...(current.data.user.app_metadata || {}),
        qf_force_password_change: false,
        qf_password_changed_at: new Date().toISOString(),
      };

      const changed = await ctx.supabaseAdmin.auth.admin.updateUserById(userId, {
        password,
        app_metadata: appMetadata,
      });

      if (changed.error) {
        return reply({ ok: false, error: "Não foi possível salvar sua nova senha." }, 400);
      }
      return reply({ ok: true });
    }

    return reply({ ok: false, error: "Ação inválida." }, 400);
  }),
};
