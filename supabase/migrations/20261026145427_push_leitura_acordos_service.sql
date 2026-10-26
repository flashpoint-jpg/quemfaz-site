-- Segunda dependência de qf_pedido_expiravel_72h: acordos confirmados preservam o pedido.
-- Mantém SECURITY INVOKER e concede somente a leitura necessária ao backend de notificações.
grant select on public.qf_comissao13_acordos to service_role;
