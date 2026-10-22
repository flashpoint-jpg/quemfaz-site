-- A função existente verifica apenas se a própria sessão é administradora.
-- A leitura do funil continua protegida por RLS.
grant usage on schema private to authenticated;
grant execute on function private.qf_is_admin() to authenticated;
