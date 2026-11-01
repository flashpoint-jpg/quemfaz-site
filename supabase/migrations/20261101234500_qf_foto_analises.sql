-- Quem Faz Foto: contador de uso, sem guardar imagens ou conteúdo dos pedidos.
create table if not exists public.qf_foto_analises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  status text not null default 'iniciada'
    check (status in ('iniciada','concluida','falhou'))
);
create index if not exists qf_foto_analises_usuario_data_idx
  on public.qf_foto_analises (user_id, criado_em desc);
alter table public.qf_foto_analises enable row level security;
-- Somente a Edge Function autenticada com service_role acessa os dados.
revoke all on public.qf_foto_analises from public, anon, authenticated;
grant select, insert, update, delete on public.qf_foto_analises to service_role;