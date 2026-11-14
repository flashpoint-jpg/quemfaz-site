-- A resposta de 72h é apenas acompanhamento; não altera status, desfecho,
-- desbloqueios, comissões nem pagamento.
create table if not exists public.qf_pedido_feedback_72h (
  chamado_id uuid primary key references public.qf_chamados(id) on delete cascade,
  cliente_id uuid not null references auth.users(id),
  resposta text not null check (resposta in ('ainda_preciso', 'ja_contratei', 'nao_preciso')),
  respondido_em timestamptz not null default now()
);

alter table public.qf_pedido_feedback_72h enable row level security;

create policy "Cliente vê a própria resposta de 72h"
  on public.qf_pedido_feedback_72h for select to authenticated
  using (cliente_id = (select auth.uid()));

create policy "Cliente responde a pedido próprio após 72h"
  on public.qf_pedido_feedback_72h for insert to authenticated
  with check (
    cliente_id = (select auth.uid())
    and exists (
      select 1 from public.qf_chamados c
      where c.id = chamado_id and c.cliente_id = (select auth.uid())
        and c.criado_em <= now() - interval '72 hours'
        and c.status in ('aberto','buscando','em_negociacao','aguardando_aceite',
          'aguardando_orcamento','orcamento_enviado','orcamento_recusado',
          'aprovado','em_andamento','sem_profissional')
    )
  );

-- Uma resposta por chamado: não alterar retrospectivamente a declaração.
grant select, insert on public.qf_pedido_feedback_72h to authenticated;
revoke update, delete on public.qf_pedido_feedback_72h from anon, authenticated;
