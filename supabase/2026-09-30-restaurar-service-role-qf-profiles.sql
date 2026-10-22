-- QuemFaz — correção do acesso rápido de cliente
-- O Edge Function quemfaz-cliente-rapido usa service_role para criar/atualizar
-- o perfil do cliente em qf_profiles. As permissões INSERT/UPDATE haviam sido
-- removidas, causando 403 e impedindo o cadastro/pedido vindo das campanhas.

grant insert, update on table public.qf_profiles to service_role;
