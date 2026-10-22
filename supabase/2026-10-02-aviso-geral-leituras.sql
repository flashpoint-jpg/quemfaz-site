-- QuemFaz V11.18.0 — aviso geral: registra quem tocou em "Entendi" e mostra ao admin quem leu e quem não leu.
create table if not exists public.qf_avisos_gerais_leituras (
  aviso_id uuid not null references public.qf_avisos_gerais(id) on delete cascade,
  user_id uuid not null,
  lido_em timestamptz not null default now(),
  primary key (aviso_id, user_id)
);
alter table public.qf_avisos_gerais_leituras enable row level security;
-- Sem policies: só as funções abaixo leem/escrevem.

-- App: quem está logado e já leu não recebe o aviso de novo (vale em qualquer aparelho).
create or replace function public.qf_aviso_geral_atual()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tipo text;
  v_aviso jsonb;
begin
  if v_uid is not null then
    select p.tipo into v_tipo from public.qf_profiles p where p.id = v_uid;
  end if;
  select jsonb_build_object('id', a.id, 'titulo', a.titulo, 'mensagem', a.mensagem, 'publico', a.publico, 'criado_em', a.criado_em)
    into v_aviso
  from public.qf_avisos_gerais a
  where a.ativo
    and (a.publico = 'todos'
      or (a.publico = 'profissionais' and v_tipo = 'profissional')
      or (a.publico = 'clientes' and v_tipo = 'cliente'))
    and (v_uid is null or not exists (
      select 1 from public.qf_avisos_gerais_leituras l where l.aviso_id = a.id and l.user_id = v_uid))
  order by a.criado_em desc
  limit 1;
  return jsonb_build_object('ok', true, 'aviso', v_aviso);
end;
$$;

-- App: a pessoa tocou em "Entendi".
create or replace function public.qf_aviso_geral_marcar_lido(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'sem_login');
  end if;
  if not exists (select 1 from public.qf_avisos_gerais a where a.id = p_id) then
    return jsonb_build_object('ok', false, 'reason', 'aviso_nao_encontrado');
  end if;
  insert into public.qf_avisos_gerais_leituras (aviso_id, user_id)
  values (p_id, auth.uid())
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: lista dos últimos avisos, agora com a contagem de quem leu.
create or replace function public.qf_admin_avisos_gerais()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.criado_em desc)
    from (
      select a.id, a.titulo, a.mensagem, a.publico, a.ativo, a.criado_em, a.encerrado_em,
        (select count(*) from public.qf_profiles p
          where p.ativo is not false
            and not exists (select 1 from public.qf_admins ad where ad.user_id = p.id)
            and (a.publico = 'todos' or (a.publico = 'profissionais' and p.tipo = 'profissional') or (a.publico = 'clientes' and p.tipo = 'cliente'))
            and exists (select 1 from public.qf_avisos_gerais_leituras l where l.aviso_id = a.id and l.user_id = p.id)) as leram,
        (select count(*) from public.qf_profiles p
          where p.ativo is not false
            and not exists (select 1 from public.qf_admins ad where ad.user_id = p.id)
            and (a.publico = 'todos' or (a.publico = 'profissionais' and p.tipo = 'profissional') or (a.publico = 'clientes' and p.tipo = 'cliente'))) as total
      from public.qf_avisos_gerais a order by a.criado_em desc limit 10) x
  ), '[]'::jsonb));
end;
$$;

-- Admin: quem leu e quem não leu um aviso.
create or replace function public.qf_admin_aviso_leituras(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_publico text;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  select a.publico into v_publico from public.qf_avisos_gerais a where a.id = p_id;
  if v_publico is null then
    return jsonb_build_object('ok', false, 'reason', 'Aviso não encontrado.');
  end if;
  return jsonb_build_object('ok', true,
    'leram', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'nome', coalesce(nullif(p.nome_fantasia, ''), p.nome), 'tipo', p.tipo, 'cidade', p.cidade, 'uf', p.uf, 'whatsapp', coalesce(nullif(p.whatsapp, ''), p.telefone), 'lido_em', l.lido_em) order by l.lido_em desc)
      from public.qf_profiles p
      join public.qf_avisos_gerais_leituras l on l.aviso_id = p_id and l.user_id = p.id
      where p.ativo is not false
        and not exists (select 1 from public.qf_admins ad where ad.user_id = p.id)
        and (v_publico = 'todos' or (v_publico = 'profissionais' and p.tipo = 'profissional') or (v_publico = 'clientes' and p.tipo = 'cliente'))
    ), '[]'::jsonb),
    'nao_leram', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', p.id, 'nome', coalesce(nullif(p.nome_fantasia, ''), p.nome), 'tipo', p.tipo, 'cidade', p.cidade, 'uf', p.uf, 'whatsapp', coalesce(nullif(p.whatsapp, ''), p.telefone)) order by p.nome)
      from public.qf_profiles p
      where p.ativo is not false
        and not exists (select 1 from public.qf_admins ad where ad.user_id = p.id)
        and (v_publico = 'todos' or (v_publico = 'profissionais' and p.tipo = 'profissional') or (v_publico = 'clientes' and p.tipo = 'cliente'))
        and not exists (select 1 from public.qf_avisos_gerais_leituras l where l.aviso_id = p_id and l.user_id = p.id)
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.qf_aviso_geral_marcar_lido(uuid) from public, anon;
revoke all on function public.qf_admin_aviso_leituras(uuid) from public, anon;
grant execute on function public.qf_aviso_geral_marcar_lido(uuid) to authenticated;
grant execute on function public.qf_admin_aviso_leituras(uuid) to authenticated;
