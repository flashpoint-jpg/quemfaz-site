-- QuemFaz 11.9.1: a chave privada VAPID do push web sai do código e vai para o Vault.
-- O segredo em si foi criado direto no banco (nunca no repositório):
--   select vault.create_secret('<chave privada>', 'qf_vapid_private', '...');
-- Só a Edge Function quemfaz-push (service_role) consegue ler.

create or replace function public.qf_push_vapid_private()
returns text
language sql
security definer
set search_path to ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'qf_vapid_private' limit 1;
$$;

revoke all on function public.qf_push_vapid_private() from public, anon, authenticated;
grant execute on function public.qf_push_vapid_private() to service_role;
