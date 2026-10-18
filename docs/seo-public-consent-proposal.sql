-- MIGRAÇÃO PROPOSTA, NÃO APLICADA. Requer aprovação específica antes de executar.
-- Opt-in por profissional; nenhum cadastro existente é autorizado retroativamente.
-- A tabela é privada; NÃO concede SELECT anônimo nem expõe dados pessoais.
begin;
create table public.qf_seo_consentimentos (
  profissional_id uuid primary key references public.qf_profissionais(user_id) on delete cascade,
  autorizado boolean not null default false,
  autorizado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  constraint qf_seo_consent_timestamp check (not autorizado or autorizado_em is not null)
);
alter table public.qf_seo_consentimentos enable row level security;
revoke all on public.qf_seo_consentimentos from public, anon;
grant select, insert, update on public.qf_seo_consentimentos to authenticated;
create policy qf_seo_consent_select_own on public.qf_seo_consentimentos
 for select to authenticated using (profissional_id = (select auth.uid()));
create policy qf_seo_consent_insert_own on public.qf_seo_consentimentos
 for insert to authenticated with check (profissional_id = (select auth.uid()));
create policy qf_seo_consent_update_own on public.qf_seo_consentimentos
 for update to authenticated using (profissional_id = (select auth.uid()))
 with check (profissional_id = (select auth.uid()));
commit;
-- REVERSÃO (somente após análise de dependências):
-- DROP TABLE public.qf_seo_consentimentos;
-- Atenção: reversão elimina os consentimentos registrados, não executar automaticamente.
-- A camada de exposição pública deverá ser criada separadamente e depender de
-- consentimento autorizado=true, com saída estritamente limitada aos dados aprovados.
-- A ativação exige timestamp explícito fornecido pela interface autenticada.
-- A revogação é UPDATE autorizado=false, autorizado_em=NULL.
