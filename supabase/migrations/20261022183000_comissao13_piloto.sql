-- Piloto opt-in, sem ativar cobrança ou alterar desbloqueio tradicional.
create table if not exists public.qf_comissao13_adesoes (
  profissional_id uuid primary key references public.qf_profissionais(user_id),
  versao_termos text not null default '13pct-v1',
  aceito_em timestamptz not null default now(),
  revogado_em timestamptz
);
create table if not exists public.qf_comissao13_acordos (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.qf_chamados(id),
  desbloqueio_id uuid not null unique references public.qf_desbloqueios(id),
  profissional_id uuid not null references public.qf_profissionais(user_id),
  cliente_id uuid references public.qf_profiles(id),
  valor_centavos bigint not null check (valor_centavos > 0),
  comissao_percentual integer not null default 13 check (comissao_percentual = 13),
  status text not null default 'proposto' check (status in ('proposto','contratado','conclusao_solicitada','concluido','pagamento_pendente','pago','repasse_pendente','repassado','contestado','cancelado')),
  criado_em timestamptz not null default now(),
  contratado_em timestamptz,
  concluido_em timestamptz,
  pago_em timestamptz,
  repassado_em timestamptz
);
create table if not exists public.qf_comissao13_eventos (
  id uuid primary key default gen_random_uuid(),
  acordo_id uuid not null references public.qf_comissao13_acordos(id),
  tipo text not null,
  idempotency_key text unique,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
alter table public.qf_comissao13_adesoes enable row level security;
alter table public.qf_comissao13_acordos enable row level security;
alter table public.qf_comissao13_eventos enable row level security;
-- Não conceder acesso à API neste estágio: somente o backend confiável,
-- após implementar verificação de identidade, OTP e webhook financeiro.
revoke all on public.qf_comissao13_adesoes from anon, authenticated;
revoke all on public.qf_comissao13_acordos from anon, authenticated;
revoke all on public.qf_comissao13_eventos from anon, authenticated;
