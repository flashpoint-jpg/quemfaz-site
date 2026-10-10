-- V11.71: o cliente escolhe quantos orçamentos quer receber (1 a 8). Pedidos antigos e os sem escolha ficam com 3.
-- (Aplicado no banco como a migração cliente_escolhe_quantos_orcamentos.)
alter table public.qf_chamados add column if not exists max_orcamentos integer not null default 3;
alter table public.qf_chamados drop constraint if exists qf_chamados_max_orcamentos_check;
alter table public.qf_chamados add constraint qf_chamados_max_orcamentos_check check (max_orcamentos between 1 and 8);

create or replace function public.qf_limite_orcamentos(p_chamado_id uuid)
returns integer language sql stable security definer set search_path to '' as $$
  select coalesce((select c.max_orcamentos from public.qf_chamados c where c.id = p_chamado_id), 3);
$$;
grant execute on function public.qf_limite_orcamentos(uuid) to anon, authenticated, service_role;

-- Onde o limite era fixo (3, ou 5 em duas funções antigas), passa a valer public.qf_limite_orcamentos(pedido):
--   public.qf_desbloquear_chamado, public.qf_contagem_participantes, public.qf_profissional_fechar_chamado,
--   private.qf_chamado_aberto_todos, private.qf_cascata_aceite, private.qf_cascata_tick,
--   public.qf_cascata_destinatarios, public.qf_chamado_destinatarios_alcance,
--   public.qf_listar_chamados_disponiveis, public.qf_portfolio_servicos, public.qf_portfolio_abertos_todos.
-- A troca foi feita por substituição de trecho em cada função (mesmo método da migração de 05/10).
