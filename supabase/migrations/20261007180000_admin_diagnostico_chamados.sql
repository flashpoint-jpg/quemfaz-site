-- QuemFaz V11.30 — integridade e observabilidade dos chamados no painel admin
-- Objetivos:
-- 1) nenhum chamado existente em qf_chamados pode sumir do diagnóstico administrativo;
-- 2) expor bairro/localização, elegíveis, avisados e etapa da cascata;
-- 3) destacar chamados abertos sem distribuição, sem alterar o fluxo do cliente/profissional.
--
-- Esta migration é aditiva. Não substitui qf_admin_snapshot nem muda regras de desbloqueio.

create or replace function public.qf_admin_diagnostico_chamados(p_dias integer default 30)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  v_dias integer := least(365, greatest(1, coalesce(p_dias, 30)));
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  return jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'dias', v_dias,
    'itens', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.criado_em desc)
      from (
        select
          c.id,
          c.cliente_id,
          c.categoria,
          c.titulo,
          c.descricao,
          c.cidade,
          c.uf,
          c.bairro,
          c.status,
          c.prioridade,
          c.criado_em,
          c.atualizado_em,
          coalesce(k.etapa, 1) as cascata_etapa,
          k.etapa1_em,
          k.etapa2_em,
          k.etapa3_em,
          k.aceito_em,
          k.aceito_por,
          coalesce((
            select count(*)
            from public.qf_profissionais pr
            join public.qf_profiles pf on pf.id = pr.user_id
            where coalesce(pf.ativo, true)
              and pr.user_id <> c.cliente_id
              and private.qf_pro_recebe_chamado(pr.user_id, c.id)
          ), 0)::integer as profissionais_elegiveis,
          coalesce((
            select count(distinct e.user_id)
            from public.qf_push_entregas e
            where e.chamado_id = c.id
              and e.evento = 'new_call'
          ), 0)::integer as profissionais_avisados,
          coalesce((
            select count(*)
            from public.qf_desbloqueios d
            where d.chamado_id = c.id
              and coalesce(d.ativo, true)
          ), 0)::integer as desbloqueios_ativos,
          case
            when nullif(trim(coalesce(c.bairro, '')), '') is null then 'bairro_ausente'
            when c.status in ('aberto','em_negociacao')
              and not exists (
                select 1 from public.qf_desbloqueios d
                where d.chamado_id = c.id and coalesce(d.ativo, true)
              )
              and coalesce((
                select count(distinct e.user_id)
                from public.qf_push_entregas e
                where e.chamado_id = c.id and e.evento = 'new_call'
              ), 0) = 0
              and c.criado_em <= now() - interval '10 minutes'
              then 'sem_distribuicao'
            when c.status in ('aberto','em_negociacao')
              and not exists (
                select 1 from public.qf_desbloqueios d
                where d.chamado_id = c.id and coalesce(d.ativo, true)
              )
              and c.criado_em <= now() - interval '24 hours'
              then 'aberto_24h'
            else 'ok'
          end as diagnostico
        from public.qf_chamados c
        left join public.qf_chamado_cascata k on k.chamado_id = c.id
        where c.criado_em >= now() - make_interval(days => v_dias)
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.qf_admin_diagnostico_chamados(integer) from public, anon;
grant execute on function public.qf_admin_diagnostico_chamados(integer) to authenticated;

-- Alerta administrativo: chamados abertos sem nenhum registro de distribuição por 10 min.
create or replace function public.qf_admin_chamados_com_falha_distribuicao()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.criado_em asc)
    from (
      select c.id, c.titulo, c.categoria, c.cidade, c.uf, c.bairro, c.status, c.criado_em,
             coalesce(k.etapa, 1) as cascata_etapa,
             coalesce((
               select count(*) from public.qf_profissionais pr
               join public.qf_profiles pf on pf.id=pr.user_id
               where coalesce(pf.ativo,true)
                 and pr.user_id<>c.cliente_id
                 and private.qf_pro_recebe_chamado(pr.user_id,c.id)
             ),0)::integer as profissionais_elegiveis
      from public.qf_chamados c
      left join public.qf_chamado_cascata k on k.chamado_id=c.id
      where c.status in ('aberto','em_negociacao')
        and c.criado_em <= now()-interval '10 minutes'
        and not exists (
          select 1 from public.qf_desbloqueios d
          where d.chamado_id=c.id and coalesce(d.ativo,true)
        )
        and not exists (
          select 1 from public.qf_push_entregas e
          where e.chamado_id=c.id and e.evento='new_call'
        )
    ) x
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.qf_admin_chamados_com_falha_distribuicao() from public, anon;
grant execute on function public.qf_admin_chamados_com_falha_distribuicao() to authenticated;
