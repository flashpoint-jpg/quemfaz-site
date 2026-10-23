-- Quem Faz Livre: estrutura preparada, NÃO ativar sem checkout Efí confirmado.
-- Migração proposta para revisão; não executada automaticamente.
create table if not exists public.qf_livre_assinaturas (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  recarga_id uuid not null unique references public.qf_recargas(id),
  valor_centavos integer not null check (valor_centavos = 3990),
  inicio_em timestamptz not null,
  fim_em timestamptz not null,
  criado_em timestamptz not null default now(),
  constraint qf_livre_periodo_valido check (fim_em = inicio_em + interval '30 days')
);
create index if not exists qf_livre_prof_fim_idx on public.qf_livre_assinaturas(profissional_id, fim_em desc);
alter table public.qf_livre_assinaturas enable row level security;
revoke all on public.qf_livre_assinaturas from anon, authenticated;
grant select on public.qf_livre_assinaturas to authenticated;
create policy qf_livre_proprio_select on public.qf_livre_assinaturas
 for select to authenticated using (profissional_id = (select auth.uid()));
-- Não permitir inserts/updates pelo cliente. A confirmação da Efí deve chamar
-- rotina privilegiada idempotente após validar recarga, valor, titularidade,
-- status aprovado e provedor. Nunca confiar em retorno do navegador.
