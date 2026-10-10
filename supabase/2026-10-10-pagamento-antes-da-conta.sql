-- QuemFaz 11.50 — plano pago ANTES de criar a conta do profissional.
-- O cadastro guarda o pagamento aqui (ainda sem conta). Quando a Efí confirma, o app cria a conta
-- e chama qf_resgatar_pre_cadastro, que vira uma recarga aprovada do plano (mesmo caminho da Carteira).

create table if not exists public.qf_pre_cadastro_pagamentos (
  id uuid primary key default gen_random_uuid(),
  segredo text not null,
  email text not null,
  nome text,
  telefone text,
  plano text not null references public.qf_planos_catalogo(plano),
  valor_centavos integer not null check (valor_centavos > 0),
  metodo text not null check (metodo in ('pix','cartao')),
  status text not null default 'pendente' check (status in ('pendente','aprovado','cancelado','expirado')),
  provedor text,
  provedor_id text,
  checkout_url text,
  profissional_id uuid references public.qf_profissionais(user_id) on delete set null,
  recarga_id uuid,
  criado_em timestamptz not null default now(),
  aprovado_em timestamptz,
  resgatado_em timestamptz
);
create index if not exists qf_pre_cadastro_email_idx on public.qf_pre_cadastro_pagamentos (lower(email), criado_em desc);
create index if not exists qf_pre_cadastro_criado_idx on public.qf_pre_cadastro_pagamentos (criado_em desc);

-- Ninguém lê nem grava direto: só a função do servidor (service role) e o resgate abaixo.
alter table public.qf_pre_cadastro_pagamentos enable row level security;
revoke all on public.qf_pre_cadastro_pagamentos from anon, authenticated;

-- O e-mail já tem conta? (conferido antes de cobrar, para ninguém pagar e não conseguir criar a conta)
create or replace function public.qf_pre_cadastro_email_livre(p_email text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not exists (select 1 from auth.users u where lower(u.email) = lower(trim(p_email)));
$$;
revoke all on function public.qf_pre_cadastro_email_livre(text) from public, anon, authenticated;
grant execute on function public.qf_pre_cadastro_email_livre(text) to service_role;

-- Conta criada: transforma o pagamento confirmado em plano ativo. Só vale uma vez.
create or replace function public.qf_resgatar_pre_cadastro(p_id uuid, p_segredo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); r public.qf_pre_cadastro_pagamentos; v_rec uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.qf_profissionais p where p.user_id = v_uid) then raise exception 'professional profile required'; end if;
  select * into r from public.qf_pre_cadastro_pagamentos where id = p_id and segredo = p_segredo for update;
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'nao_encontrado'); end if;
  if r.profissional_id is not null then
    if r.profissional_id = v_uid then return jsonb_build_object('ok', true, 'ja_resgatado', true, 'plano', r.plano, 'recarga_id', r.recarga_id); end if;
    return jsonb_build_object('ok', false, 'error', 'ja_usado');
  end if;
  if r.status <> 'aprovado' then return jsonb_build_object('ok', false, 'error', 'nao_pago', 'status', r.status); end if;

  insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, provedor, provedor_id, plano)
  values (v_uid, r.valor_centavos, r.metodo, 'pendente', r.provedor, r.provedor_id, r.plano)
  returning id into v_rec;
  -- A mudança para "aprovado" dispara a ativação do plano (qf_recarga_pagamento_aplicado).
  update public.qf_recargas set status = 'aprovado' where id = v_rec;

  update public.qf_pre_cadastro_pagamentos
     set profissional_id = v_uid, recarga_id = v_rec, resgatado_em = now()
   where id = r.id;
  return jsonb_build_object('ok', true, 'plano', r.plano, 'recarga_id', v_rec, 'valor_centavos', r.valor_centavos);
end $$;
revoke all on function public.qf_resgatar_pre_cadastro(uuid, text) from public, anon;
grant execute on function public.qf_resgatar_pre_cadastro(uuid, text) to authenticated;

-- A função do servidor (service role) lê o catálogo e grava os pagamentos do pré-cadastro.
grant select on public.qf_planos_catalogo to service_role;
grant select, insert, update on public.qf_pre_cadastro_pagamentos to service_role;
