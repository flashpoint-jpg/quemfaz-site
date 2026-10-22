-- Cleanup is a status transition, never a deletion. Existing admin status triggers
-- retain the audit trail. Garante has its own lifecycle and is left unchanged.
create or replace function private.qf_pedido_expiravel_72h(c public.qf_chamados)
returns boolean language sql stable security invoker set search_path = ''
as $function$
  select coalesce(
    c.status = 'aberto'
    and c.atendimento_tipo is distinct from 'garante'
    and c.criado_em < now() - interval '72 hours'
    -- Dates without a time remain valid for the entire local service day.
    and (c.data_preferida is null or
         (c.data_preferida at time zone 'America/Sao_Paulo')::date <
         (now() at time zone 'America/Sao_Paulo')::date)
    and (c.prazo_dia is null or c.prazo_dia <
         (now() at time zone 'America/Sao_Paulo')::date)
    -- Any historical unlock protects the order, including inactive/refunded ones.
    and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id = c.id)
    and not exists(select 1 from public.qf_orcamentos o
                   where o.chamado_id = c.id and o.status = 'aceito'), false);
$function$;
revoke all on function private.qf_pedido_expiravel_72h(public.qf_chamados) from public, anon, authenticated;
grant execute on function private.qf_pedido_expiravel_72h(public.qf_chamados) to service_role;

create or replace function private.qf_expirar_chamados()
returns integer language plpgsql security invoker set search_path = ''
as $function$
declare v_n integer;
begin
  with alvo as (
    select c.id from public.qf_chamados c
    where private.qf_pedido_expiravel_72h(c)
    for update of c skip locked
  )
  update public.qf_chamados c
     set status = 'cancelado', atualizado_em = now()
    from alvo where c.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function private.qf_expirar_chamados() from public, anon, authenticated;

-- The former 3-day negotiation timeout conflicts with preservation of unlocked
-- orders. Disable the scheduler and make direct/legacy calls harmless as well.
create or replace function private.qf_fechar_sem_retorno()
returns integer language sql security invoker set search_path = ''
as $function$ select 0; $function$;
revoke all on function private.qf_fechar_sem_retorno() from public, anon, authenticated;

-- Apply only the availability predicate to the existing functions. Keep their
-- eligibility, pricing, contact masking, permissions and Garante logic intact.
-- Fail atomically if an expected anchor has changed; never rewrite blindly.
do $patch$
declare r record; v_def text; v_new text; v_count integer := 0;
  v_anchor text := 'c.status in (''aberto'',''em_negociacao'')';
begin
  for r in select p.oid, p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'qf_listar_chamados_disponiveis', 'qf_outros_pedidos_vitrine',
      'qf_outros_pedidos_vitrine_v2', 'qf_chamado_destinatarios_alcance',
      'qf_cascata_destinatarios', 'qf_push_reservar_entregas',
      'qf_push_aberto_todos_destinatarios'])
  loop
    v_count := v_count + 1;
    v_def := pg_get_functiondef(r.oid);
    if strpos(v_def, 'private.qf_pedido_expiravel_72h(c)') > 0 then continue; end if;
    if r.proname = 'qf_push_aberto_todos_destinatarios' then
      v_new := replace(v_def, 'where c.id = p_chamado_id',
        'where c.id = p_chamado_id and c.status in (''aberto'',''em_negociacao'') and not private.qf_pedido_expiravel_72h(c)');
    else
      v_new := replace(v_def, v_anchor,
        v_anchor || ' and not private.qf_pedido_expiravel_72h(c)');
    end if;
    if v_new = v_def then raise exception 'Missing cleanup anchor in %', r.proname; end if;
    execute v_new;
  end loop;
  if v_count <> 7 then raise exception 'Expected 7 availability functions, found %', v_count; end if;
end;
$patch$;

select cron.alter_job(jobid, active := false) from cron.job
where jobname in ('qf-fechar-sem-retorno', 'qf-cancelar-sem-resposta-48h');
select cron.schedule('qf-expirar-chamados', '* * * * *', 'select private.qf_expirar_chamados();');
-- The immediate cleanup is run separately, with before/after protection checks,
-- so its exact affected-row count can be reported without a scheduler race.
