-- QuemFaz — Confirmação de interesse do cliente no pedido (selo "Interesse confirmado pelo cliente").
-- MIGRAÇÃO ADITIVA e idempotente. Só ACRESCENTA colunas, gatilho e uma função de leitura.
-- Não altera pedidos existentes (ficam com as duas colunas vazias), nem preços, créditos, carteiras,
-- pagamentos, desbloqueios ou o limite de 4 profissionais por pedido.
--
-- 1) O pedido ganha a escolha do cliente: 'contratar' ("Sim, quero receber propostas para contratar")
--    ou 'pesquisando' ("Estou apenas pesquisando preços"). Vazio = cliente não respondeu (pedidos antigos).
-- 2) A data e hora da confirmação são gravadas pelo BANCO (now()), nunca pelo aparelho. A escolha não muda depois.
-- 3) O profissional lê só quem confirmou 'contratar', por qf_interesse_info_chamados (sem nome, telefone nem endereço).
--    Quem marcou "apenas pesquisando" nunca aparece nessa leitura, então nenhum selo é mostrado.
-- O selo NÃO significa contratação garantida e o cliente não fica obrigado a contratar.

-- 1) Colunas (nulas por padrão: nada é marcado automaticamente)
alter table public.qf_chamados add column if not exists interesse_cliente text;
alter table public.qf_chamados add column if not exists interesse_confirmado_em timestamptz;
alter table public.qf_chamados drop constraint if exists qf_chamados_interesse_check;
alter table public.qf_chamados add constraint qf_chamados_interesse_check
  check (interesse_cliente is null or interesse_cliente in ('contratar', 'pesquisando'));
alter table public.qf_chamados drop constraint if exists qf_chamados_interesse_data_check;
alter table public.qf_chamados add constraint qf_chamados_interesse_data_check
  check ((interesse_cliente is null) = (interesse_confirmado_em is null));
grant select (interesse_cliente, interesse_confirmado_em) on public.qf_chamados to authenticated;
grant insert (interesse_cliente, interesse_confirmado_em) on public.qf_chamados to authenticated;

-- 2) Data/hora do servidor na criação; depois disso a escolha é imutável
create or replace function private.qf_chamado_interesse_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.interesse_cliente is null then
      new.interesse_confirmado_em := null;
    else
      new.interesse_confirmado_em := now();
    end if;
    return new;
  end if;
  if new.interesse_cliente is distinct from old.interesse_cliente
     or new.interesse_confirmado_em is distinct from old.interesse_confirmado_em then
    raise exception 'interesse_imutavel';
  end if;
  return new;
end $$;
drop trigger if exists qf_chamado_interesse_guard_before_write on public.qf_chamados;
create trigger qf_chamado_interesse_guard_before_write
  before insert or update of interesse_cliente, interesse_confirmado_em on public.qf_chamados
  for each row execute function private.qf_chamado_interesse_guard();

-- 3) Leitura segura para quem pode ver o pedido (mesma regra do orçamento aproximado)
create or replace function public.qf_interesse_info_chamados(p_ids uuid[])
returns table (chamado_id uuid, interesse_confirmado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.interesse_confirmado_em
    from public.qf_chamados c
   where c.id = any (p_ids[1:100])
     and c.interesse_cliente = 'contratar'
     and auth.uid() is not null
     and (
       c.cliente_id = auth.uid()
       or private.qf_is_admin()
       or exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = auth.uid())
       or (c.status in ('aberto', 'em_negociacao') and exists (select 1 from public.qf_profissionais pf where pf.user_id = auth.uid()))
     );
$$;
revoke all on function public.qf_interesse_info_chamados(uuid[]) from public, anon;
grant execute on function public.qf_interesse_info_chamados(uuid[]) to authenticated;
