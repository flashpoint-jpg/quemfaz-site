-- QuemFaz V11.22.0 — fluxo simples: Aberto → Desbloqueado → Concluído / Cancelado.
-- O orçamento saiu do app (a conversa acontece no WhatsApp). O profissional só informa
-- como terminou: "Fechei o serviço" ou "Não fechei". Sem resposta em 7 dias, o pedido
-- é encerrado sozinho como "sem retorno".
--
-- Nada é apagado nem convertido: pedidos antigos em 'confirmado' e 'em_andamento'
-- continuam com o mesmo status no banco e aparecem como "Desbloqueado" no app.
-- Orçamentos antigos (qf_orcamentos) ficam guardados.
--
-- Para voltar atrás: reaplicar private.qf_expirar_chamados de
-- 2026-10-01-chat-portfolio-programados.sql e desligar o agendamento:
--   select cron.unschedule(jobid) from cron.job where jobname = 'qf-fechar-sem-retorno';

-- 1) Desfecho do pedido desbloqueado -------------------------------------------------
alter table public.qf_chamados
  add column if not exists desfecho text,
  add column if not exists desfecho_em timestamptz;

alter table public.qf_chamados drop constraint if exists qf_chamados_desfecho_check;
alter table public.qf_chamados add constraint qf_chamados_desfecho_check
  check (desfecho is null or desfecho in ('fechado', 'nao_fechado', 'sem_retorno'));

comment on column public.qf_chamados.desfecho is
  'Como terminou o pedido desbloqueado: fechado / nao_fechado (profissional informou) / sem_retorno (7 dias sem resposta).';

-- 2) Profissional informa se fechou ---------------------------------------------------
create or replace function public.qf_profissional_fechar_chamado(p_chamado_id uuid, p_fechou boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_prof uuid := auth.uid();
  v_status text;
  v_orc uuid;
begin
  if v_prof is null then
    raise exception 'authentication required';
  end if;
  if p_fechou is null then
    return jsonb_build_object('ok', false, 'reason', 'Informe se o serviço foi fechado ou não.');
  end if;

  select c.status into v_status
  from public.qf_chamados c
  where c.id = p_chamado_id
  for update;

  if v_status is null then
    return jsonb_build_object('ok', false, 'reason', 'Pedido não encontrado.');
  end if;

  if not exists (
    select 1 from public.qf_desbloqueios d
    where d.chamado_id = p_chamado_id
      and d.profissional_id = v_prof
      and coalesce(d.ativo, true)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'Este pedido não está desbloqueado por você.');
  end if;

  if v_status not in ('em_negociacao', 'confirmado', 'em_andamento') then
    return jsonb_build_object('ok', false, 'reason', 'Este pedido já foi encerrado.', 'status', v_status);
  end if;

  if p_fechou then
    -- Registra o profissional como o escolhido, do mesmo jeito que qf_confirmar_profissional:
    -- é a proposta aceita que libera o pedido concluído e a avaliação para ele.
    if not exists (
      select 1 from public.qf_orcamentos o
      where o.chamado_id = p_chamado_id and o.profissional_id = v_prof and o.status = 'aceito'
    ) then
      select o.id into v_orc
      from public.qf_orcamentos o
      where o.chamado_id = p_chamado_id and o.profissional_id = v_prof and o.status = 'enviado'
      order by o.criado_em desc
      limit 1
      for update;

      if v_orc is null then
        insert into public.qf_orcamentos(
          chamado_id, profissional_id, valor_centavos, descricao, status,
          mao_obra_centavos, material_centavos, taxa_visita_centavos
        )
        values (p_chamado_id, v_prof, 0, 'Serviço fechado direto com o cliente', 'aceito', 0, 0, 0);
      else
        update public.qf_orcamentos
           set status = 'aceito', motivo_recusa = null, atualizado_em = now()
         where id = v_orc;
      end if;
    end if;

    update public.qf_chamados
       set status = 'concluido', desfecho = 'fechado', desfecho_em = now(), atualizado_em = now()
     where id = p_chamado_id;

    return jsonb_build_object('ok', true, 'status', 'concluido', 'desfecho', 'fechado');
  end if;

  -- Não fechou: encerra o pedido. O desbloqueio continua registrado e o crédito não volta.
  update public.qf_chamados
     set status = 'cancelado', desfecho = 'nao_fechado', desfecho_em = now(), atualizado_em = now()
   where id = p_chamado_id;

  return jsonb_build_object('ok', true, 'status', 'cancelado', 'desfecho', 'nao_fechado');
end;
$function$;

revoke execute on function public.qf_profissional_fechar_chamado(uuid, boolean) from public, anon;
grant execute on function public.qf_profissional_fechar_chamado(uuid, boolean) to authenticated;

-- 3) Fechamento automático: 7 dias desbloqueado sem o profissional informar --------------
create or replace function private.qf_fechar_sem_retorno()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer;
begin
  with alvo as (
    select c.id
    from public.qf_chamados c
    where c.status in ('em_negociacao', 'confirmado', 'em_andamento')
      -- serviço agendado para frente só conta 7 dias depois da data marcada
      and (c.data_preferida is null or c.data_preferida < now() - interval '7 days')
      and exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and coalesce(d.ativo, true)
      )
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and coalesce(d.ativo, true)
          and d.criado_em > now() - interval '7 days'
      )
    for update skip locked
  )
  update public.qf_chamados c
     set status = 'cancelado', desfecho = 'sem_retorno', desfecho_em = now(), atualizado_em = now()
    from alvo
   where c.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

select cron.unschedule(jobid) from cron.job where jobname = 'qf-fechar-sem-retorno';
select cron.schedule('qf-fechar-sem-retorno', '17 * * * *', 'select private.qf_fechar_sem_retorno();');

-- 4) A expiração de 3 dias passa a valer só para pedido ABERTO (sem profissional) -------
-- Antes ela também encerrava pedido desbloqueado depois de 3 dias parado, o que
-- atropelaria o prazo de 7 dias acima.
create or replace function private.qf_expirar_chamados()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer;
begin
  with alvo as (
    select c.id
    from public.qf_chamados c
    where c.status = 'aberto'
      and c.criado_em < now() - interval '3 days'
      and c.atualizado_em < now() - interval '3 days'
      and (c.data_preferida is null or c.data_preferida < now() - interval '3 days')
      and not (
        coalesce(c.prioridade, false)
        and c.prioridade_ate is not null
        and c.prioridade_ate > now()
      )
      and not exists (
        select 1 from public.qf_orcamentos o
        where o.chamado_id = c.id
          and greatest(o.criado_em, o.atualizado_em) > now() - interval '3 days'
      )
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and d.criado_em > now() - interval '3 days'
      )
    for update skip locked
  )
  update public.qf_chamados c
     set status = 'expirado', atualizado_em = now()
    from alvo
   where c.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
