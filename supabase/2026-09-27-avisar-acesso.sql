-- V11.11.7: fila do admin para avisar quem se cadastrou e nunca entrou. Já aplicado em dczlyrgnzlxmzghzaooz.
create table if not exists public.qf_admin_avisos_acesso (
  user_id uuid primary key references auth.users(id) on delete cascade,
  avisado_em timestamptz not null default now(),
  vezes int not null default 1
);
alter table public.qf_admin_avisos_acesso enable row level security;
-- funções: public.qf_admin_nunca_entraram() e public.qf_admin_marcar_avisado(uuid), só admin (qf_private.is_admin()).
