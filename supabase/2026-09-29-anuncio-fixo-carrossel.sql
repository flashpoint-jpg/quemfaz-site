-- QuemFaz — anúncio institucional fixo no carrossel.
alter table public.qf_anuncios
  add column if not exists fixo boolean not null default false;

create index if not exists qf_anuncios_fixo_idx
  on public.qf_anuncios (fixo, status, pagamento_status, criado_em desc);
