-- QuemFaz V11.43 — nota para o próprio QuemFaz, dada pelo cliente e pelo profissional ao finalizar.
-- Aditiva: não muda a avaliação entre cliente e profissional (qf_avaliacoes).

create table if not exists public.qf_notas_app (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null check (papel in ('cliente','profissional')),
  nota smallint not null check (nota between 1 and 5),
  comentario text,
  chamado_id text,
  criado_em timestamptz not null default now()
);
create index if not exists qf_notas_app_criado_idx on public.qf_notas_app (criado_em desc);
create index if not exists qf_notas_app_user_idx on public.qf_notas_app (user_id);

-- Só entra e sai pelas funções abaixo.
alter table public.qf_notas_app enable row level security;
revoke all on table public.qf_notas_app from anon, authenticated;

create or replace function public.qf_enviar_nota_app(p_nota integer, p_comentario text default null, p_chamado_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_papel text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'sem_sessao'); end if;
  if p_nota is null or p_nota < 1 or p_nota > 5 then return jsonb_build_object('ok', false, 'reason', 'nota_invalida'); end if;
  select p.tipo into v_papel from public.qf_profiles p where p.id = v_uid;
  if v_papel is null or v_papel not in ('cliente','profissional') then
    return jsonb_build_object('ok', false, 'reason', 'sem_perfil');
  end if;
  insert into public.qf_notas_app (user_id, papel, nota, comentario, chamado_id)
  values (v_uid, v_papel, p_nota, nullif(left(btrim(coalesce(p_comentario, '')), 500), ''), nullif(left(btrim(coalesce(p_chamado_id, '')), 80), ''));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.qf_enviar_nota_app(integer,text,text) from public, anon;
grant execute on function public.qf_enviar_nota_app(integer,text,text) to authenticated;

create or replace function public.qf_admin_notas_app()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object(
    'ok', true,
    'total', (select count(*) from public.qf_notas_app),
    'media', (select round(avg(nota)::numeric, 1) from public.qf_notas_app),
    'clientes', (select jsonb_build_object('total', count(*), 'media', round(avg(nota)::numeric, 1)) from public.qf_notas_app where papel = 'cliente'),
    'profissionais', (select jsonb_build_object('total', count(*), 'media', round(avg(nota)::numeric, 1)) from public.qf_notas_app where papel = 'profissional'),
    'itens', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.criado_em desc)
      from (
        select n.nota, n.papel, n.comentario, n.criado_em, p.nome
        from public.qf_notas_app n
        left join public.qf_profiles p on p.id = n.user_id
        order by n.criado_em desc
        limit 50
      ) x
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.qf_admin_notas_app() from public, anon;
grant execute on function public.qf_admin_notas_app() to authenticated;
