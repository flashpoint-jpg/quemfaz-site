-- Monitoramento de como os profissionais acessam o QuemFaz (app Android, PWA, navegador).
-- Somente estrutura nova: não altera cadastros, pagamentos, créditos, bônus, chamados, raio ou desbloqueios.

create table if not exists public.qf_profissional_acessos (
  id bigint generated always as identity primary key,
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  tipo_acesso text not null check (tipo_acesso in ('play_store','pwa','navegador','desconhecido')),
  confianca text not null default 'inferida' check (confianca in ('confirmada','inferida')),
  evidencia text,
  app_versao text,
  push_permissao text check (push_permissao in ('granted','denied','default','unsupported')),
  push_ativo boolean,
  acessado_em timestamptz not null default now()
);

create index if not exists qf_profissional_acessos_prof_data_idx
  on public.qf_profissional_acessos(profissional_id, acessado_em desc);
create index if not exists qf_profissional_acessos_data_idx
  on public.qf_profissional_acessos(acessado_em desc);

alter table public.qf_profissional_acessos enable row level security;
revoke all on public.qf_profissional_acessos from anon, authenticated;
grant select on public.qf_profissional_acessos to authenticated;
grant all on public.qf_profissional_acessos to service_role;
grant usage, select on sequence public.qf_profissional_acessos_id_seq to service_role;

-- Cada profissional só enxerga os próprios registros. Gravação apenas pela função abaixo.
drop policy if exists "profissional_consulta_proprio_acesso" on public.qf_profissional_acessos;
create policy "profissional_consulta_proprio_acesso" on public.qf_profissional_acessos
  for select to authenticated using ((select auth.uid()) = profissional_id);

-- Registro do acesso (chamado pelo app depois do login do profissional).
-- Limita a frequência: no máximo 1 linha a cada 30 min, salvo mudança de tipo ou de notificações.
create or replace function public.qf_registrar_acesso_profissional(
  p_tipo text,
  p_confianca text default 'inferida',
  p_evidencia text default null,
  p_app_versao text default null,
  p_push_permissao text default null,
  p_push_ativo boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_tipo text := case when p_tipo in ('play_store','pwa','navegador','desconhecido') then p_tipo else 'desconhecido' end;
  v_conf text := case when p_confianca = 'confirmada' then 'confirmada' else 'inferida' end;
  v_perm text := case when p_push_permissao in ('granted','denied','default','unsupported') then p_push_permissao else null end;
  v_ult record;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.qf_profissionais p where p.user_id = v_uid) then
    return jsonb_build_object('registrado', false, 'motivo', 'nao_profissional');
  end if;

  select a.acessado_em, a.tipo_acesso, a.push_permissao, a.push_ativo
    into v_ult
    from public.qf_profissional_acessos a
   where a.profissional_id = v_uid
   order by a.acessado_em desc
   limit 1;

  if found
     and v_ult.acessado_em > now() - interval '30 minutes'
     and v_ult.tipo_acesso = v_tipo
     and v_ult.push_permissao is not distinct from v_perm
     and v_ult.push_ativo is not distinct from p_push_ativo then
    return jsonb_build_object('registrado', false, 'motivo', 'recente');
  end if;

  insert into public.qf_profissional_acessos
    (profissional_id, tipo_acesso, confianca, evidencia, app_versao, push_permissao, push_ativo)
  values
    (v_uid, v_tipo, v_conf, left(p_evidencia, 80), left(p_app_versao, 40), v_perm, p_push_ativo);

  return jsonb_build_object('registrado', true);
end;
$$;

revoke all on function public.qf_registrar_acesso_profissional(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.qf_registrar_acesso_profissional(text, text, text, text, text, boolean) to authenticated;

-- Consulta consolidada: somente administradores (qf_admins).
-- Profissionais sem registro mostram o tipo como null; quando há push nativo (fcm:) o tipo vem
-- como ESTIMATIVA em tipo_estimado, nunca como informação confirmada.
create or replace function public.qf_admin_monitoramento_profissionais()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_linhas jsonb;
begin
  if v_uid is null or not exists (select 1 from public.qf_admins a where a.user_id = v_uid) then
    raise exception 'forbidden';
  end if;

  with ult as (
    select distinct on (a.profissional_id)
           a.profissional_id, a.tipo_acesso, a.confianca, a.app_versao,
           a.push_permissao, a.push_ativo, a.acessado_em
      from public.qf_profissional_acessos a
     order by a.profissional_id, a.acessado_em desc
  ), dias as (
    select a.profissional_id,
           count(distinct (a.acessado_em at time zone 'America/Sao_Paulo')::date)
             filter (where a.acessado_em >= now() - interval '7 days') as dias_7d,
           count(distinct (a.acessado_em at time zone 'America/Sao_Paulo')::date)
             filter (where a.acessado_em >= now() - interval '30 days') as dias_30d
      from public.qf_profissional_acessos a
     where a.acessado_em >= now() - interval '30 days'
     group by a.profissional_id
  ), push as (
    select s.user_id,
           count(*) filter (where s.ativo) as subs_ativas,
           bool_or(s.ativo and s.endpoint like 'fcm:%') as nativo_ativo,
           bool_or(s.ativo and s.endpoint not like 'fcm:%') as web_ativo
      from public.qf_push_subscriptions s
     group by s.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'profissional_id', p.user_id,
      'nome', coalesce(nullif(pf.nome_fantasia, ''), pf.nome),
      'cidade', pf.cidade,
      'uf', pf.uf,
      'cadastrado_em', p.criado_em,
      'tipo_acesso', u.tipo_acesso,
      'confianca', u.confianca,
      'app_versao', u.app_versao,
      'tipo_estimado', case when u.profissional_id is null and ps.nativo_ativo then 'app_android'
                            when u.profissional_id is null and ps.web_ativo then 'web_pwa_ou_navegador'
                            else null end,
      'ultimo_acesso', u.acessado_em,
      'dias_ativos_7d', coalesce(d.dias_7d, 0),
      'dias_ativos_30d', coalesce(d.dias_30d, 0),
      'ativo_7d', coalesce(d.dias_7d, 0) > 0,
      'ativo_30d', coalesce(d.dias_30d, 0) > 0,
      'notificacoes', case when coalesce(ps.subs_ativas, 0) > 0 then 'ativas'
                           when u.push_permissao = 'denied' then 'bloqueadas'
                           else 'inativas' end,
      'push_permissao', u.push_permissao
    ) order by u.acessado_em desc nulls last, p.criado_em desc), '[]'::jsonb)
    into v_linhas
    from public.qf_profissionais p
    left join public.qf_profiles pf on pf.id = p.user_id
    left join ult u on u.profissional_id = p.user_id
    left join dias d on d.profissional_id = p.user_id
    left join push ps on ps.user_id = p.user_id;

  return jsonb_build_object(
    'gerado_em', now(),
    'linhas', v_linhas
  );
end;
$$;

revoke all on function public.qf_admin_monitoramento_profissionais() from public, anon;
grant execute on function public.qf_admin_monitoramento_profissionais() to authenticated;
