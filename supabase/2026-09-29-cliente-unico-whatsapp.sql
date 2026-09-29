-- QuemFaz 11.14.36
-- Um cliente por WhatsApp: normaliza o número e encontra o cadastro canônico mais antigo.
-- A consolidação dos registros antigos no painel é não destrutiva para preservar históricos.

create or replace function public.qf_normalizar_whatsapp(p_valor text)
returns text
language sql
immutable
parallel safe
as $$
  with d as (
    select regexp_replace(coalesce(p_valor, ''), '[^0-9]', '', 'g') as v
  )
  select case
    when left(v, 2) = '55' and length(v) in (12, 13) then substr(v, 3)
    else v
  end
  from d;
$$;

create index if not exists qf_profiles_cliente_whatsapp_norm_idx
  on public.qf_profiles (
    public.qf_normalizar_whatsapp(coalesce(nullif(whatsapp, ''), telefone))
  )
  where tipo = 'cliente';

create or replace function public.qf_cliente_canonico_por_whatsapp(p_whatsapp text)
returns table (
  id uuid,
  nome text,
  email text,
  telefone text,
  whatsapp text,
  criado_em timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.nome,
    p.email,
    p.telefone,
    p.whatsapp,
    p.criado_em
  from public.qf_profiles p
  where p.tipo = 'cliente'
    and public.qf_normalizar_whatsapp(coalesce(nullif(p.whatsapp, ''), p.telefone))
        = public.qf_normalizar_whatsapp(p_whatsapp)
    and public.qf_normalizar_whatsapp(p_whatsapp) <> ''
  order by p.criado_em asc, p.id asc
  limit 1;
$$;

revoke all on function public.qf_cliente_canonico_por_whatsapp(text) from public;
grant execute on function public.qf_cliente_canonico_por_whatsapp(text) to service_role;
