-- PROPOSTA PARA REVISÃO: NÃO EXECUTAR SEM APROVAÇÃO DE MIGRAÇÃO.
-- Consentimento opt-in, padrão privado. Não modifica tabelas financeiras.
create table if not exists public.qf_seo_consentimentos (
  profissional_id uuid primary key references public.qf_profissionais(user_id) on delete cascade,
  autorizado boolean not null default false,
  autorizado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  constraint consent_timestamp check (not autorizado or autorizado_em is not null)
);
alter table public.qf_seo_consentimentos enable row level security;
revoke all on public.qf_seo_consentimentos from anon;
grant select, insert, update on public.qf_seo_consentimentos to authenticated;
create policy "seo_consent_select_own" on public.qf_seo_consentimentos
  for select to authenticated using (profissional_id = (select auth.uid()));
create policy "seo_consent_insert_own" on public.qf_seo_consentimentos
  for insert to authenticated with check (profissional_id = (select auth.uid()));
create policy "seo_consent_update_own" on public.qf_seo_consentimentos
  for update to authenticated using (profissional_id = (select auth.uid()))
  with check (profissional_id = (select auth.uid()));
-- Não expor qf_profiles, qf_profissionais ou qf_profissional_cidades
-- diretamente ao público. Endpoint futuro deve consultar apenas opt-ins
-- e devolver campos estritamente aprovados, após verificação de raio.
