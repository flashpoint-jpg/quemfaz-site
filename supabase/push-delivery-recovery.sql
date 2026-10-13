-- Delivery accounting: historical reservations are not proof of delivery.
alter table public.qf_push_entregas
  add column if not exists envio_status text not null default 'legado',
  add column if not exists tentativas integer not null default 0,
  add column if not exists tentativa_em timestamptz,
  add column if not exists enviado_em timestamptz,
  add column if not exists envio_erro text;

create or replace function public.qf_push_reservar_entregas(p_chamado_id uuid,p_user_ids uuid[],p_evento text,p_raio_etapa_km integer)
returns uuid[] language plpgsql security invoker set search_path='' as $$
declare v_ids uuid[]; v_etapa smallint; v_rodada integer;
begin
  if not exists(select 1 from public.qf_chamados c where c.id=p_chamado_id and c.status in ('aberto','em_negociacao'))
    or exists(select 1 from public.qf_orcamentos o where o.chamado_id=p_chamado_id and o.status='aceito')
    or (select count(*) from public.qf_desbloqueios d where d.chamado_id=p_chamado_id and coalesce(d.ativo,true)) >= public.qf_limite_orcamentos(p_chamado_id)
  then return array[]::uuid[]; end if;
  select etapa,rodada into v_etapa,v_rodada from public.qf_chamado_cascata where chamado_id=p_chamado_id;
  with reserved as (
    insert into public.qf_push_entregas as e(chamado_id,user_id,evento,raio_etapa_km,cascata_etapa,rodada,envio_status,tentativas,tentativa_em)
    select p_chamado_id,u,p_evento,p_raio_etapa_km,coalesce(v_etapa,1),coalesce(v_rodada,1),'processando',1,now()
    from (select distinct unnest(coalesce(p_user_ids,array[]::uuid[])) u) ids
    where not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=p_chamado_id and d.profissional_id=u)
    on conflict(chamado_id,user_id,evento,rodada) do update
    set envio_status='processando',tentativas=e.tentativas+1,tentativa_em=now(),envio_erro=null,
      com_push=exists(select 1 from public.qf_push_subscriptions s where s.user_id=e.user_id and s.ativo)
    where e.tentativas<3 and (
      (e.envio_status in ('falhou','sem_inscricao','fora_horario','reenvio_solicitado') and e.tentativa_em < now()-interval '5 minutes')
      or (e.envio_status='processando' and e.tentativa_em < now()-interval '10 minutes')
    ) and exists(select 1 from public.qf_push_subscriptions s where s.user_id=e.user_id and s.ativo)
    returning user_id
  ) select coalesce(array_agg(user_id),array[]::uuid[]) into v_ids from reserved;
  return v_ids;
end $$;
revoke all on function public.qf_push_reservar_entregas(uuid,uuid[],text,integer) from public,anon,authenticated;
grant execute on function public.qf_push_reservar_entregas(uuid,uuid[],text,integer) to service_role;

create or replace function public.qf_admin_push_resultados(p_chamado_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.qf_is_admin() then return jsonb_build_object('ok',false,'reason','sem_permissao'); end if;
  return jsonb_build_object('ok',true,'itens',coalesce((
    select jsonb_agg(t) from (
      select chamado_id as id,
        count(distinct user_id) filter(where envio_status='enviado') as enviados,
        count(distinct user_id) filter(where envio_status='sem_inscricao') as sem_inscricao,
        count(distinct user_id) filter(where envio_status='falhou') as falhas,
        count(distinct user_id) filter(where envio_status='legado') as sem_confirmacao
      from public.qf_push_entregas where chamado_id=any(p_chamado_ids) and evento='new_call' group by chamado_id
    ) t
  ),'[]'::jsonb));
end $$;
revoke all on function public.qf_admin_push_resultados(uuid[]) from public,anon;
grant execute on function public.qf_admin_push_resultados(uuid[]) to authenticated;

create or replace function private.qf_repetir_push_falhos()
returns integer language plpgsql security definer set search_path='' as $$
declare r record; v_total integer:=0;
begin
  for r in
    select distinct e.chamado_id from public.qf_push_entregas e
    join public.qf_chamados c on c.id=e.chamado_id
    where e.evento='new_call' and e.tentativas<3 and c.status in ('aberto','em_negociacao')
      and c.criado_em>now()-interval '7 days'
      and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
      and (select count(*) from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true))<public.qf_limite_orcamentos(c.id)
      and ((e.envio_status in ('falhou','sem_inscricao','fora_horario','reenvio_solicitado') and e.tentativa_em<now()-interval '5 minutes')
        or (e.envio_status='processando' and e.tentativa_em<now()-interval '10 minutes'))
      and exists(select 1 from public.qf_push_subscriptions s where s.user_id=e.user_id and s.ativo)
      -- Exact radius and all eligibility rules are checked by sendNewCallStage.
      -- Do not recompute the full candidate set for every delivery row.
      and exists(select 1 from public.qf_profissionais p where p.user_id=e.user_id and p.online
        and private.qf_dentro_horario(p.horario_inicio,p.horario_fim))
    limit 25
  loop
    perform private.qf_push_interno('retry_call',r.chamado_id);
    v_total:=v_total+1;
  end loop;
  return v_total;
end $$;
revoke all on function private.qf_repetir_push_falhos() from public,anon,authenticated;
-- Scheduled only after the compatible Edge Function has been deployed.


-- Allow time for the provider sends; per-person results remain durable if the caller times out.
do $update$ declare v_definition text; begin
 select pg_get_functiondef(p.oid) into v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='qf_push_interno';
 if v_definition is null then raise exception 'Internal push helper not found'; end if;
 execute replace(v_definition,'timeout_milliseconds := 5000','timeout_milliseconds := 30000');
end $update$;
-- Enable only after deploying the compatible Edge Function:
select cron.schedule('qf-push-repetir-falhas','*/5 * * * *','select private.qf_repetir_push_falhos();');
