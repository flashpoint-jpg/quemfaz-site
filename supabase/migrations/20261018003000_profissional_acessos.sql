-- Monitoramento de acesso de profissionais. Não altera cadastros ou pedidos existentes.
create table if not exists public.qf_profissional_acessos (
  id bigint generated always as identity primary key,
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  tipo_acesso text not null check (tipo_acesso in ('play_store','pwa','navegador','desconhecido')),
  confianca text not null default 'inferida' check (confianca in ('confirmada','inferida')),
  push_permitido boolean,
  push_inscrito boolean,
  acessado_em timestamptz not null default now()
);
create index if not exists qf_profissional_acessos_prof_data_idx
  on public.qf_profissional_acessos(profissional_id, acessado_em desc);
create index if not exists qf_profissional_acessos_data_idx
  on public.qf_profissional_acessos(acessado_em desc);
alter table public.qf_profissional_acessos enable row level security;
revoke all on public.qf_profissional_acessos from anon;
grant insert, select on public.qf_profissional_acessos to authenticated;
grant usage, select on sequence public.qf_profissional_acessos_id_seq to authenticated;
create policy "profissional_insere_proprio_acesso" on public.qf_profissional_acessos
 for insert to authenticated with check ((select auth.uid()) = profissional_id);
create policy "profissional_consulta_proprio_acesso" on public.qf_profissional_acessos
 for select to authenticated using ((select auth.uid()) = profissional_id);
-- Consultas agregadas de todos os profissionais devem ser feitas por backend administrativo autenticado.
