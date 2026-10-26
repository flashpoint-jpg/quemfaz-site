-- O push usa qf_push_reservar_entregas -> qf_pedido_expiravel_72h (SECURITY INVOKER).
-- Sem SELECT, essa validação aborta com 42501 antes de registrar/enviar o pedido.
-- Permissão exclusiva do backend: nenhuma concessão ao navegador e nenhum UPDATE financeiro.
grant select on public.qf_comissao13_fechamentos to service_role;
