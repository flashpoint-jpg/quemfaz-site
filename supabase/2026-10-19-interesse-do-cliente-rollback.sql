-- Reversão de 2026-10-19-interesse-do-cliente.sql (uso manual, só se for preciso desfazer).
-- ATENÇÃO: apagar as colunas descarta a escolha já gravada pelos clientes. Não toca em mais nada.
drop function if exists public.qf_interesse_info_chamados(uuid[]);
drop trigger if exists qf_chamado_interesse_guard_before_write on public.qf_chamados;
drop function if exists private.qf_chamado_interesse_guard();
alter table public.qf_chamados drop constraint if exists qf_chamados_interesse_data_check;
alter table public.qf_chamados drop constraint if exists qf_chamados_interesse_check;
alter table public.qf_chamados drop column if exists interesse_confirmado_em;
alter table public.qf_chamados drop column if exists interesse_cliente;
