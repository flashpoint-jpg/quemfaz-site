-- QuemFaz — categorias de serviço criadas pelos próprios profissionais.
-- A categoria fica pública para busca dos clientes, mas só usuário autenticado pode criar.

create table if not exists public.qf_categorias_personalizadas (
  id text primary key,
  nome text not null,
  criado_por uuid not null default auth.uid() references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table public.qf_categorias_personalizadas enable row level security;

grant select on table public.qf_categorias_personalizadas to anon, authenticated;
grant insert on table public.qf_categorias_personalizadas to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='qf_categorias_personalizadas'
      and policyname='qf_categorias_leitura'
  ) then
    create policy qf_categorias_leitura
      on public.qf_categorias_personalizadas
      for select to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='qf_categorias_personalizadas'
      and policyname='qf_categorias_criacao'
  ) then
    create policy qf_categorias_criacao
      on public.qf_categorias_personalizadas
      for insert to authenticated
      with check (criado_por = auth.uid());
  end if;
end
$$;
