-- QuemFaz 11.16.8 — resposta do cliente consolida a negociação; sem resposta em 48h cancela e devolve o lead.

CREATE OR REPLACE FUNCTION qf_private.devolver_leads_no_cancelamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  r record;
  v_cliente_respondeu boolean;
begin
  if new.status not in ('cancelado','expirado')
     or old.status not in ('aberto','em_negociacao') then
    return new;
  end if;

  for r in
    select d.id, d.profissional_id, d.criado_em
    from public.qf_desbloqueios d
    where d.chamado_id = new.id
      and d.ativo
      and not exists (
        select 1
        from public.qf_orcamentos o
        where o.chamado_id = d.chamado_id
          and o.profissional_id = d.profissional_id
          and o.status = 'aceito'
      )
    for update
  loop
    select exists (
      select 1
      from public.qf_chat_mensagens m
      where m.chamado_id = new.id
        and m.profissional_id = r.profissional_id
        and m.remetente_id = new.cliente_id
        and m.tipo = 'mensagem'
        and m.criado_em >= r.criado_em
    ) into v_cliente_respondeu;

    if not v_cliente_respondeu then
      perform qf_private.devolver_lead(
        r.id,
        case
          when new.status = 'expirado' then 'chamado_expirou'
          else 'cliente_cancelou'
        end
      );
    end if;

    update public.qf_desbloqueios
       set ativo = false
     where id = r.id
       and ativo;
  end loop;

  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.qf_pedir_devolucao_lead(p_chamado_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_prof uuid := auth.uid();
  d public.qf_desbloqueios;
  v_status text;
  v_cliente uuid;
  v_usados int;
  v_valor int;
begin
  if v_prof is null then raise exception 'authentication required'; end if;

  select * into d
  from public.qf_desbloqueios
  where chamado_id=p_chamado_id and profissional_id=v_prof
  for update;

  if d.id is null then return jsonb_build_object('ok',false,'reason','sem_desbloqueio'); end if;
  if exists (select 1 from public.qf_devolucoes_lead where desbloqueio_id=d.id) then
    return jsonb_build_object('ok',false,'reason','ja_devolvido');
  end if;
  if not d.ativo then return jsonb_build_object('ok',false,'reason','sem_desbloqueio'); end if;
  if not (d.origem='plano' or (d.origem='saldo' and coalesce(d.valor_centavos,0)>0)) then
    return jsonb_build_object('ok',false,'reason','sem_cobranca');
  end if;
  if d.criado_em > now()-interval '48 hours' then
    return jsonb_build_object('ok',false,'reason','aguarde_48h','liberado_em',d.criado_em+interval '48 hours');
  end if;

  select status,cliente_id into v_status,v_cliente
  from public.qf_chamados
  where id=p_chamado_id
  for update;

  if v_status <> 'em_negociacao' then
    return jsonb_build_object('ok',false,'reason','status_invalido','status',v_status);
  end if;

  if exists (
    select 1 from public.qf_chat_mensagens m
    where m.chamado_id=p_chamado_id
      and m.profissional_id=v_prof
      and m.remetente_id=v_cliente
      and m.tipo='mensagem'
      and m.criado_em>=d.criado_em
  ) or exists (
    select 1 from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id
      and o.profissional_id=v_prof
      and o.status in ('aceito','recusado','nao_selecionado')
  ) then
    return jsonb_build_object('ok',false,'reason','cliente_respondeu');
  end if;

  select count(*) into v_usados
  from public.qf_devolucoes_lead
  where profissional_id=v_prof
    and motivo='cliente_nao_respondeu'
    and criado_em>now()-interval '30 days';

  if v_usados>=2 then
    return jsonb_build_object('ok',false,'reason','limite_mensal','limite',2);
  end if;

  v_valor := qf_private.devolver_lead(d.id,'cliente_nao_respondeu');
  if v_valor<=0 then return jsonb_build_object('ok',false,'reason','sem_cobranca'); end if;

  update public.qf_orcamentos
     set status='cancelado',
         motivo_recusa='Sem resposta do cliente em 48 horas (lead devolvido)',
         atualizado_em=now()
   where chamado_id=p_chamado_id
     and profissional_id=v_prof
     and status='enviado';

  update public.qf_chamados
     set status='cancelado',atualizado_em=now()
   where id=p_chamado_id and status='em_negociacao';

  return jsonb_build_object(
    'ok',true,
    'valor_centavos',case when d.origem='plano' then 0 else v_valor end,
    'origem',d.origem,
    'usados_30d',v_usados+1,
    'limite',2,
    'status','cancelado'
  );
end
$function$;

CREATE OR REPLACE FUNCTION private.qf_cancelar_sem_resposta_48h()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select
      c.id as chamado_id,
      c.cliente_id,
      d.id as desbloqueio_id,
      d.profissional_id
    from public.qf_chamados c
    join public.qf_desbloqueios d
      on d.chamado_id=c.id
     and d.ativo
    where c.status='em_negociacao'
      and d.criado_em <= now()-interval '48 hours'
      and not exists (
        select 1
        from public.qf_chat_mensagens m
        where m.chamado_id=c.id
          and m.profissional_id=d.profissional_id
          and m.remetente_id=c.cliente_id
          and m.tipo='mensagem'
          and m.criado_em>=d.criado_em
      )
      and not exists (
        select 1
        from public.qf_orcamentos o
        where o.chamado_id=c.id
          and o.profissional_id=d.profissional_id
          and o.status in ('aceito','recusado','nao_selecionado')
      )
    order by d.criado_em
    for update of c,d skip locked
  loop
    perform qf_private.devolver_lead(r.desbloqueio_id,'cliente_nao_respondeu');

    update public.qf_desbloqueios
       set ativo=false
     where id=r.desbloqueio_id
       and ativo;

    update public.qf_orcamentos
       set status='cancelado',
           motivo_recusa='Pedido cancelado: cliente não respondeu em 48 horas.',
           atualizado_em=now()
     where chamado_id=r.chamado_id
       and profissional_id=r.profissional_id
       and status='enviado';

    update public.qf_chamados
       set status='cancelado',
           atualizado_em=now()
     where id=r.chamado_id
       and status='em_negociacao';

    v_n := v_n + 1;
  end loop;

  return v_n;
end
$function$;

REVOKE ALL ON FUNCTION private.qf_cancelar_sem_resposta_48h() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname='qf-cancelar-sem-resposta-48h'
  ) THEN
    PERFORM cron.schedule(
      'qf-cancelar-sem-resposta-48h',
      '*/10 * * * *',
      'select private.qf_cancelar_sem_resposta_48h();'
    );
  END IF;
END
$$;
