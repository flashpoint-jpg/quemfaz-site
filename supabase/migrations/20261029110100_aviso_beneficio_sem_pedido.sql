-- Um benefício de plano não pertence a um pedido. Os demais avisos continuam exigindo pedido.
alter table public.qf_profissional_avisos alter column chamado_id drop not null;
alter table public.qf_profissional_avisos add constraint qf_aviso_pedido_ou_beneficio
check(chamado_id is not null or tipo='livre_beneficio');
