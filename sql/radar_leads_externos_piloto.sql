-- Radar de leads: staging isolado, sem permissões públicas
create table if not exists public.qf_leads_externos (
 id uuid primary key default gen_random_uuid(),
 source text not null,
 source_url text not null,
 service text,
 city text,
 excerpt text,
 status text not null default 'novo',
 consent_status text not null default 'nao_verificado',
 confirmed_chamado_id text,
 first_seen_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '30 days'),
 unique(source,source_url)
);
alter table public.qf_leads_externos enable row level security;
revoke all on public.qf_leads_externos from anon, authenticated;
create table if not exists public.qf_lead_events (
 id bigint generated always as identity primary key,
 lead_id uuid not null references public.qf_leads_externos(id) on delete cascade,
 event_type text not null,
 created_at timestamptz not null default now()
);
alter table public.qf_lead_events enable row level security;
revoke all on public.qf_lead_events from anon, authenticated;
