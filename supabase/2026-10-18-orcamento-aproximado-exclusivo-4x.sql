-- QuemFaz — Orçamento aproximado no pedido + desbloqueio normal ou exclusivo (4x). Issue #92.
-- MIGRAÇÃO CORRETIVA e idempotente. Não apaga pedidos, créditos, avaliações, históricos nem a tabela de taxas.
--
-- 1) Pedido ganha o campo de orçamento APROXIMADO (estimativa; não é preço fechado nem contratação).
-- 2) Quem pode ver o pedido lê o orçamento (sem dado pessoal) por qf_orcamento_info_chamados.
-- 3) Retira a modalidade "valor definido" com 6% de taxa e limite de 1 profissional: nenhum pedido novo
--    pode ser criado nela e nenhuma cobrança percentual pode mais ser feita.
-- 4) Desbloqueio exclusivo passa a custar exatamente 4x o desbloqueio normal (qf_config.desbloqueio_exclusivo).
--    A função qf_desbloquear_chamado(uuid, boolean) JÁ É transacional (trava o pedido e a carteira) e NÃO muda.

-- 1) Orçamento aproximado
alter table public.qf_chamados add column if not exists orcamento_aproximado_centavos integer;
alter table public.qf_chamados drop constraint if exists qf_chamados_orcamento_aprox_check;
alter table public.qf_chamados add constraint qf_chamados_orcamento_aprox_check
  check (orcamento_aproximado_centavos is null or (orcamento_aproximado_centavos >= 100 and orcamento_aproximado_centavos <= 50000000));
grant select, insert, update (orcamento_aproximado_centavos) on public.qf_chamados to authenticated;

-- 2) Leitura segura (sem nome, telefone nem endereço)
create or replace function public.qf_orcamento_info_chamados(p_ids uuid[])
returns table (chamado_id uuid, orcamento_aproximado_centavos integer)
language sql stable security definer set search_path = '' as $$
  select c.id, c.orcamento_aproximado_centavos
    from public.qf_chamados c
   where c.id = any (p_ids[1:100])
     and c.orcamento_aproximado_centavos is not null
     and auth.uid() is not null
     and (
       c.cliente_id = auth.uid()
       or private.qf_is_admin()
       or exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = auth.uid())
       or (c.status in ('aberto', 'em_negociacao') and exists (select 1 from public.qf_profissionais pf where pf.user_id = auth.uid()))
     );
$$;
revoke all on function public.qf_orcamento_info_chamados(uuid[]) from public, anon;
grant execute on function public.qf_orcamento_info_chamados(uuid[]) to authenticated;

-- 3) Aposenta "valor definido" (6% + 1 profissional)
create or replace function private.qf_chamado_valor_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.modalidade is distinct from 'contatos' then raise exception 'modalidade_descontinuada'; end if;
    new.modalidade := 'contatos';
    new.valor_oferecido_centavos := null; new.material_incluso := null;
    new.valor_confirmado_em := null; new.condicoes_valor := null;
    return new;
  end if;
  if new.modalidade is distinct from old.modalidade
     or new.valor_oferecido_centavos is distinct from old.valor_oferecido_centavos
     or new.material_incluso is distinct from old.material_incluso
     or new.valor_confirmado_em is distinct from old.valor_confirmado_em
     or new.condicoes_valor is distinct from old.condicoes_valor then
    raise exception 'pedido_valor_imutavel';
  end if;
  return new;
end $$;

create or replace function public.qf_desbloquear_chamado_valor(p_chamado_id uuid, p_taxa_confirmada_centavos integer default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', false, 'reason', 'modalidade_descontinuada');
$$;

drop function if exists public.qf_valor_info_chamados(uuid[]);
drop function if exists public.qf_taxa_indicacao_centavos(text, integer);
drop function if exists public.qf_admin_taxas_indicacao();
drop function if exists public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean);

create or replace function private.qf_valor_cfg()
returns jsonb language sql stable security definer set search_path = '' as $$
  select (jsonb_build_object('ativo', false, 'valor_min_centavos', 2000,
                             'valor_max_centavos', 50000000, 'contestacao_dias', 15, 'conclusao_validade_dias', 7)
         || coalesce((select c.valor from public.qf_config c where c.chave = 'pedidos_valor_definido'), '{}'::jsonb)) - 'percentual_bps';
$$;
create or replace function public.qf_pedidos_valor_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ativo', coalesce((private.qf_valor_cfg()->>'ativo')::boolean, false),
    'valor_min_centavos', (private.qf_valor_cfg()->>'valor_min_centavos')::integer,
    'valor_max_centavos', (private.qf_valor_cfg()->>'valor_max_centavos')::integer);
$$;
update public.qf_config set valor = valor - 'percentual_bps', atualizado_em = now()
 where chave = 'pedidos_valor_definido' and valor ? 'percentual_bps';

-- 4) Exclusivo = exatamente 4x o desbloqueio normal vigente
insert into public.qf_config (chave, valor, atualizado_em)
values ('desbloqueio_exclusivo', '{"ativo": true, "multiplicador": 4}'::jsonb, now())
on conflict (chave) do update
  set valor = jsonb_set(coalesce(public.qf_config.valor, '{}'::jsonb), '{multiplicador}', '4'::jsonb), atualizado_em = now();
