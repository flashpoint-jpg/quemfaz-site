-- QuemFaz 11.26
-- Código de acesso do cliente: 6 dígitos que ele anota depois do pedido.
-- Para entrar por outro aparelho: WhatsApp + código. 5 erros seguidos bloqueiam por 15 minutos.

create table if not exists public.qf_cliente_codigos (
  cliente_id uuid primary key references public.qf_profiles(id) on delete cascade,
  codigo text not null,
  falhas integer not null default 0,
  bloqueado_ate timestamptz,
  criado_em timestamptz not null default now()
);

-- Sem políticas: ninguém lê nem grava direto. Só pelas funções abaixo.
alter table public.qf_cliente_codigos enable row level security;
revoke all on public.qf_cliente_codigos from anon, authenticated;

-- O cliente logado consulta o próprio código (cria na primeira vez).
create or replace function public.qf_meu_codigo_acesso()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_codigo text;
begin
  if v_uid is null then return null; end if;
  if not exists (select 1 from public.qf_profiles p where p.id = v_uid and p.tipo = 'cliente') then
    return null;
  end if;

  select c.codigo into v_codigo from public.qf_cliente_codigos c where c.cliente_id = v_uid;
  if v_codigo is null then
    v_codigo := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    insert into public.qf_cliente_codigos (cliente_id, codigo)
    values (v_uid, v_codigo)
    on conflict (cliente_id) do nothing;
    select c.codigo into v_codigo from public.qf_cliente_codigos c where c.cliente_id = v_uid;
  end if;
  return v_codigo;
end;
$$;

revoke all on function public.qf_meu_codigo_acesso() from public, anon;
grant execute on function public.qf_meu_codigo_acesso() to authenticated;

-- Conferência do código (só a função de acesso, com a chave de serviço, pode chamar).
-- Retorna 'ok', 'errado' ou 'bloqueado'.
create or replace function public.qf_conferir_codigo_acesso(p_cliente uuid, p_codigo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.qf_cliente_codigos%rowtype;
  v_codigo text := regexp_replace(coalesce(p_codigo, ''), '[^0-9]', '', 'g');
begin
  select * into r from public.qf_cliente_codigos c where c.cliente_id = p_cliente for update;
  if not found then return 'errado'; end if;
  if r.bloqueado_ate is not null and r.bloqueado_ate > now() then return 'bloqueado'; end if;

  if length(v_codigo) = 6 and v_codigo = r.codigo then
    update public.qf_cliente_codigos set falhas = 0, bloqueado_ate = null where cliente_id = p_cliente;
    return 'ok';
  end if;

  if r.falhas + 1 >= 5 then
    update public.qf_cliente_codigos set falhas = 0, bloqueado_ate = now() + interval '15 minutes' where cliente_id = p_cliente;
    return 'bloqueado';
  end if;
  update public.qf_cliente_codigos set falhas = r.falhas + 1 where cliente_id = p_cliente;
  return 'errado';
end;
$$;

revoke all on function public.qf_conferir_codigo_acesso(uuid, text) from public, anon, authenticated;
grant execute on function public.qf_conferir_codigo_acesso(uuid, text) to service_role;
