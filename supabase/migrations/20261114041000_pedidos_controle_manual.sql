-- Os pedidos não expiram pelo relógio: o cliente decide ou o admin atua no painel.
-- Não altera a expiração de Pix pendente, bônus, nem regras financeiras.
select cron.alter_job(jobid, active := false)
from cron.job where jobname = 'qf-expirar-chamados';

-- Proteção contra chamadas antigas que invoquem a rotina diretamente, e contra
-- filtros de distribuição que tratavam pedidos válidos como expirados.
create or replace function private.qf_pedido_expiravel_72h(c public.qf_chamados)
returns boolean language sql stable security invoker set search_path = ''
as $function$ select false; $function$;

create or replace function private.qf_expirar_chamados()
returns integer language sql security invoker set search_path = ''
as $function$ select 0; $function$;

-- A pergunta fica disponível desde a publicação, sem exigência de 72h.
drop policy if exists "Cliente responde a pedido próprio após 72h" on public.qf_pedido_feedback_72h;
create policy "Cliente informa necessidade de pedido próprio"
on public.qf_pedido_feedback_72h for insert to authenticated
with check (
  cliente_id = (select auth.uid()) and exists (
    select 1 from public.qf_chamados c
    where c.id = chamado_id and c.cliente_id = (select auth.uid())
      and c.status in ('aberto','buscando','em_negociacao','aguardando_aceite',
        'aguardando_orcamento','orcamento_enviado','orcamento_recusado',
        'aprovado','em_andamento','sem_profissional')
  )
);
create policy "Cliente pode atualizar resposta de pedido próprio"
on public.qf_pedido_feedback_72h for update to authenticated
using (cliente_id = (select auth.uid()))
with check (cliente_id = (select auth.uid()));
grant update on public.qf_pedido_feedback_72h to authenticated;

-- Grava resposta e cancelamento no mesmo ato. Contratação declarada não é
-- conclusão comprovada, e nenhuma resposta altera saldo, Pix ou desbloqueios.
create or replace function public.qf_cliente_atualizar_necessidade(
  p_chamado_id uuid, p_resposta text
) returns jsonb
language plpgsql security invoker set search_path = ''
as $function$
declare c public.qf_chamados%rowtype;
begin
  if (select auth.uid()) is null or p_resposta not in
    ('ainda_preciso', 'ja_contratei', 'nao_preciso') then
    return jsonb_build_object('ok', false, 'reason', 'resposta_invalida');
  end if;
  select * into c from public.qf_chamados
    where id = p_chamado_id and cliente_id = (select auth.uid()) for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if c.status not in ('aberto','buscando','em_negociacao','aguardando_aceite',
        'aguardando_orcamento','orcamento_enviado','orcamento_recusado',
        'aprovado','em_andamento','sem_profissional') then
    return jsonb_build_object('ok', false, 'reason', 'pedido_nao_ativo');
  end if;
  insert into public.qf_pedido_feedback_72h(chamado_id,cliente_id,resposta)
    values(p_chamado_id, (select auth.uid()), p_resposta)
  on conflict (chamado_id) do update
    set resposta = excluded.resposta, respondido_em = now();
  if p_resposta = 'nao_preciso' then
    update public.qf_chamados set status = 'cancelado', atualizado_em = now()
    where id = p_chamado_id and cliente_id = (select auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'status',
    case when p_resposta = 'nao_preciso' then 'cancelado' else c.status end);
end;
$function$;

revoke all on function public.qf_cliente_atualizar_necessidade(uuid,text)
from public, anon;
grant execute on function public.qf_cliente_atualizar_necessidade(uuid,text)
to authenticated;
