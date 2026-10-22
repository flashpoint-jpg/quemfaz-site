-- QuemFaz V11.17.0 — aviso geral na tela (comunicado do admin para todo mundo no app).
-- Só um aviso fica no ar por vez; publicar um novo encerra o anterior.
create table if not exists public.qf_avisos_gerais (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  mensagem text not null,
  publico text not null default 'profissionais' check (publico in ('todos', 'profissionais', 'clientes')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  criado_por uuid
);
create index if not exists qf_avisos_gerais_ativo_idx on public.qf_avisos_gerais (ativo, criado_em desc);
alter table public.qf_avisos_gerais enable row level security;
-- Sem policies: a tabela só é lida/escrita pelas funções abaixo.

-- App: aviso que está no ar para quem abriu (visitante sem conta só vê aviso para "todos").
create or replace function public.qf_aviso_geral_atual()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_tipo text;
  v_aviso jsonb;
begin
  if auth.uid() is not null then
    select p.tipo into v_tipo from public.qf_profiles p where p.id = auth.uid();
  end if;
  select jsonb_build_object('id', a.id, 'titulo', a.titulo, 'mensagem', a.mensagem, 'publico', a.publico, 'criado_em', a.criado_em)
    into v_aviso
  from public.qf_avisos_gerais a
  where a.ativo
    and (a.publico = 'todos'
      or (a.publico = 'profissionais' and v_tipo = 'profissional')
      or (a.publico = 'clientes' and v_tipo = 'cliente'))
  order by a.criado_em desc
  limit 1;
  return jsonb_build_object('ok', true, 'aviso', v_aviso);
end;
$$;

-- Admin: lista os últimos avisos.
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
    from (select a.id, a.titulo, a.mensagem, a.publico, a.ativo, a.criado_em, a.encerrado_em
          from public.qf_avisos_gerais a order by a.criado_em desc limit 10) x
  ), '[]'::jsonb));
end;
$$;

-- Admin: publica um aviso (encerra o que estava no ar).
create or replace function public.qf_admin_publicar_aviso_geral(p_titulo text, p_mensagem text, p_publico text default 'profissionais')
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_msg text := btrim(coalesce(p_mensagem, ''));
  v_publico text := coalesce(nullif(btrim(coalesce(p_publico, '')), ''), 'profissionais');
  v_id uuid;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if v_publico not in ('todos', 'profissionais', 'clientes') then
    return jsonb_build_object('ok', false, 'reason', 'Escolha quem vai receber o aviso.');
  end if;
  if char_length(v_titulo) < 3 or char_length(v_titulo) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'O título precisa ter de 3 a 80 letras.');
  end if;
  if char_length(v_msg) < 10 or char_length(v_msg) > 1500 then
    return jsonb_build_object('ok', false, 'reason', 'A mensagem precisa ter de 10 a 1500 letras.');
  end if;
  update public.qf_avisos_gerais set ativo = false, encerrado_em = now() where ativo;
  insert into public.qf_avisos_gerais (titulo, mensagem, publico, criado_por)
  values (v_titulo, v_msg, v_publico, auth.uid())
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Admin: tira o aviso do ar.
create or replace function public.qf_admin_encerrar_aviso_geral(p_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  update public.qf_avisos_gerais set ativo = false, encerrado_em = now()
  where ativo and (p_id is null or id = p_id);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.qf_aviso_geral_atual() from public;
revoke all on function public.qf_admin_avisos_gerais() from public, anon;
revoke all on function public.qf_admin_publicar_aviso_geral(text, text, text) from public, anon;
revoke all on function public.qf_admin_encerrar_aviso_geral(uuid) from public, anon;
grant execute on function public.qf_aviso_geral_atual() to anon, authenticated;
grant execute on function public.qf_admin_avisos_gerais() to authenticated;
grant execute on function public.qf_admin_publicar_aviso_geral(text, text, text) to authenticated;
grant execute on function public.qf_admin_encerrar_aviso_geral(uuid) to authenticated;
