-- QuemFaz — Pedidos com valor definido, taxa de indicação, baixa por QR Code,
-- cancelamento por imprevisto, contestação de desbloqueio e painel administrativo.
--
-- STATUS: PROPOSTA PARA REVISÃO. NÃO foi aplicada no banco de produção.
-- TUDO FICA DESLIGADO enquanto qf_config.pedidos_valor_definido.ativo = false (valor inicial).
-- Nada aqui apaga ou altera pedidos, créditos, avaliações ou históricos existentes:
--   * qf_chamados só ganha colunas novas (modalidade nasce 'contatos' para todos os pedidos atuais);
--   * os preços de desbloqueio dos pedidos tradicionais e a função qf_desbloquear_chamado NÃO mudam;
--   * a única função existente reescrita é qf_private.devolver_lead (ganha uma guarda de 3 linhas).
-- Reversão: supabase/2026-10-18-pedidos-valor-definido-qr-rollback.sql
--
-- Pagamento da taxa: créditos da Carteira. Quem não tem saldo recebe 'saldo_insuficiente' com o valor exato
-- e usa a recarga Pix já existente (qf_recargas + webhook da Efí). O contato só é liberado depois do débito,
-- na mesma transação em que o desbloqueio é gravado.

-- ---------------------------------------------------------------------------------------------
-- 1) Configuração e chave geral (desligada)
-- ---------------------------------------------------------------------------------------------
insert into public.qf_config (chave, valor)
values ('pedidos_valor_definido', jsonb_build_object(
  'ativo', false,
  'percentual_bps', 600,              -- 6,00% do valor informado pelo cliente
  'valor_min_centavos', 2000,         -- R$ 20,00
  'valor_max_centavos', 50000000,     -- R$ 500.000,00
  'contestacao_dias', 15,
  'conclusao_validade_dias', 7))
on conflict (chave) do nothing;

create or replace function private.qf_valor_cfg()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ativo', false, 'percentual_bps', 600, 'valor_min_centavos', 2000,
                            'valor_max_centavos', 50000000, 'contestacao_dias', 15, 'conclusao_validade_dias', 7)
         || coalesce((select c.valor from public.qf_config c where c.chave = 'pedidos_valor_definido'), '{}'::jsonb);
$$;

create or replace function public.qf_pedidos_valor_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'ativo', coalesce((private.qf_valor_cfg()->>'ativo')::boolean, false),
    'percentual_bps', (private.qf_valor_cfg()->>'percentual_bps')::integer,
    'valor_min_centavos', (private.qf_valor_cfg()->>'valor_min_centavos')::integer,
    'valor_max_centavos', (private.qf_valor_cfg()->>'valor_max_centavos')::integer);
$$;
revoke all on function public.qf_pedidos_valor_config() from public;
grant execute on function public.qf_pedidos_valor_config() to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2) Colunas novas no pedido + trava de integridade
-- ---------------------------------------------------------------------------------------------
alter table public.qf_chamados add column if not exists modalidade text not null default 'contatos';
alter table public.qf_chamados add column if not exists valor_oferecido_centavos integer;
alter table public.qf_chamados add column if not exists material_incluso boolean;
alter table public.qf_chamados add column if not exists valor_confirmado_em timestamptz;
alter table public.qf_chamados add column if not exists condicoes_valor text;

alter table public.qf_chamados drop constraint if exists qf_chamados_modalidade_check;
alter table public.qf_chamados add constraint qf_chamados_modalidade_check check (
  (modalidade = 'contatos'
     and valor_oferecido_centavos is null and material_incluso is null and valor_confirmado_em is null)
  or
  (modalidade = 'valor_definido'
     and valor_oferecido_centavos > 0 and material_incluso is not null
     and valor_confirmado_em is not null and max_orcamentos = 1));

create or replace function private.qf_chamado_valor_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cfg jsonb;
begin
  if tg_op = 'INSERT' then
    if new.modalidade is distinct from 'valor_definido' then
      new.modalidade := 'contatos';
      new.valor_oferecido_centavos := null;
      new.material_incluso := null;
      new.valor_confirmado_em := null;
      new.condicoes_valor := null;
      return new;
    end if;
    cfg := private.qf_valor_cfg();
    if not coalesce((cfg->>'ativo')::boolean, false) then
      raise exception 'valor_definido_desativado';
    end if;
    if new.valor_oferecido_centavos is null
       or new.valor_oferecido_centavos < (cfg->>'valor_min_centavos')::integer
       or new.valor_oferecido_centavos > (cfg->>'valor_max_centavos')::integer then
      raise exception 'valor_invalido';
    end if;
    if new.material_incluso is null then raise exception 'material_obrigatorio'; end if;
    if new.valor_confirmado_em is null then raise exception 'confirmacao_obrigatoria'; end if;
    if new.status not in ('aberto', 'aguardando_pagamento') then raise exception 'status_invalido_valor_definido'; end if;
    new.valor_confirmado_em := now();   -- a hora vale a do servidor, nunca a do aparelho
    new.max_orcamentos := 1;            -- inicialmente só 1 profissional pode desbloquear
    return new;
  end if;

  -- UPDATE: modalidade, valor, material, confirmação e condições não mudam depois de publicado.
  if new.modalidade is distinct from old.modalidade
     or new.valor_oferecido_centavos is distinct from old.valor_oferecido_centavos
     or new.material_incluso is distinct from old.material_incluso
     or new.valor_confirmado_em is distinct from old.valor_confirmado_em
     or new.condicoes_valor is distinct from old.condicoes_valor then
    raise exception 'pedido_valor_imutavel';
  end if;
  if old.modalidade = 'valor_definido' then new.max_orcamentos := 1; end if;
  return new;
end $$;

drop trigger if exists qf_chamado_valor_guard_before_write on public.qf_chamados;
create trigger qf_chamado_valor_guard_before_write
  before insert or update on public.qf_chamados
  for each row execute function private.qf_chamado_valor_guard();

-- ---------------------------------------------------------------------------------------------
-- 3) Taxa de indicação (6% inicial, teto por profissão) — calculada só no servidor
-- ---------------------------------------------------------------------------------------------
create table if not exists public.qf_taxas_indicacao (
  categoria text primary key,                       -- 'padrao' vale para qualquer profissão sem linha própria (inclui novas)
  percentual_bps integer not null check (percentual_bps between 0 and 5000),
  teto_centavos integer check (teto_centavos is null or teto_centavos >= 0),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid
);
alter table public.qf_taxas_indicacao enable row level security;
revoke all on public.qf_taxas_indicacao from anon, authenticated;
insert into public.qf_taxas_indicacao (categoria, percentual_bps, teto_centavos)
values ('padrao', 600, null) on conflict (categoria) do nothing;

create or replace function public.qf_taxa_indicacao_centavos(p_categoria text, p_valor_centavos integer)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare v_bps integer; v_teto integer; v_taxa bigint;
begin
  if p_valor_centavos is null or p_valor_centavos <= 0 then return 0; end if;
  select t.percentual_bps, t.teto_centavos into v_bps, v_teto
    from public.qf_taxas_indicacao t where t.categoria = p_categoria and t.ativo;
  if not found then
    select t.percentual_bps, t.teto_centavos into v_bps, v_teto
      from public.qf_taxas_indicacao t where t.categoria = 'padrao' and t.ativo;
  end if;
  if v_bps is null then v_bps := (private.qf_valor_cfg()->>'percentual_bps')::integer; end if;
  v_taxa := (p_valor_centavos::bigint * v_bps + 5000) / 10000;       -- arredonda meio centavo para cima
  if v_teto is not null then v_taxa := least(v_taxa, v_teto); end if;
  return greatest(v_taxa, 0)::integer;
end $$;
revoke all on function public.qf_taxa_indicacao_centavos(text, integer) from public, anon;
grant execute on function public.qf_taxa_indicacao_centavos(text, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4) Histórico auditável de ações (só o servidor escreve; só o admin lê)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.qf_pedido_eventos (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null,
  tipo text not null,
  ator_id uuid,
  ator_papel text,
  dados jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists qf_pedido_eventos_chamado_idx on public.qf_pedido_eventos (chamado_id, criado_em);
alter table public.qf_pedido_eventos enable row level security;
revoke all on public.qf_pedido_eventos from anon, authenticated;

create or replace function private.qf_evento(p_chamado uuid, p_tipo text, p_ator uuid, p_papel text, p_dados jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.qf_pedido_eventos (chamado_id, tipo, ator_id, ator_papel, dados)
  values (p_chamado, p_tipo, p_ator, p_papel, coalesce(p_dados, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------------------
-- 5) Desbloqueio com taxa de indicação (pedido com valor definido)
-- ---------------------------------------------------------------------------------------------
-- Barreira: nenhum caminho (nem a função tradicional) grava desbloqueio de pedido de valor definido
-- sem passar por qf_desbloquear_chamado_valor, que cobra a taxa certa. Assim a função antiga não vira atalho.
create or replace function private.qf_desbloqueio_valor_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.qf_chamados c where c.id = new.chamado_id and c.modalidade = 'valor_definido')
     and coalesce(current_setting('qf.valor_unlock', true), '') <> '1'
     and not coalesce(private.qf_is_admin(), false) then
    raise exception 'desbloqueio_valor_definido_requer_taxa';
  end if;
  return new;
end $$;

drop trigger if exists qf_desbloqueio_valor_guard_before_insert on public.qf_desbloqueios;
create trigger qf_desbloqueio_valor_guard_before_insert
  before insert on public.qf_desbloqueios
  for each row execute function private.qf_desbloqueio_valor_guard();

create or replace function public.qf_desbloquear_chamado_valor(p_chamado_id uuid, p_taxa_confirmada_centavos integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_prof uuid := auth.uid();
  c public.qf_chamados%rowtype;
  v_pendencia uuid;
  v_taxa integer;
  v_saldo bigint;
  v_ativos integer;
  v_exist public.qf_desbloqueios%rowtype;
begin
  if v_prof is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.qf_profissionais where user_id = v_prof) then
    raise exception 'professional profile required';
  end if;
  if not coalesce((private.qf_valor_cfg()->>'ativo')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'desativado');
  end if;

  v_pendencia := private.qf_pendencia_finalizacao(v_prof, 'profissional');
  if v_pendencia is not null then
    return jsonb_build_object('ok', false, 'reason', 'avaliacao_pendente', 'chamado_id', v_pendencia);
  end if;
  if not exists (select 1 from public.qf_profiles where id = v_prof and nullif(trim(coalesce(foto_url, '')), '') is not null) then
    return jsonb_build_object('ok', false, 'reason', 'selfie_obrigatoria');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qf_valor_unlock:' || p_chamado_id::text || ':' || v_prof::text, 0));

  select * into c from public.qf_chamados where id = p_chamado_id for update;
  if not found then raise exception 'call not found'; end if;
  if c.modalidade <> 'valor_definido' then
    return jsonb_build_object('ok', false, 'reason', 'modalidade_invalida');
  end if;
  if c.cliente_id = v_prof then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;

  select * into v_exist from public.qf_desbloqueios where chamado_id = p_chamado_id and profissional_id = v_prof;
  if found then
    if coalesce(v_exist.ativo, true) then
      return jsonb_build_object('ok', true, 'already_unlocked', true,
        'taxa_centavos', coalesce(v_exist.valor_centavos, 0), 'valor_centavos', c.valor_oferecido_centavos);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'ja_participou');
  end if;

  if c.status not in ('aberto', 'em_negociacao') then return jsonb_build_object('ok', false, 'reason', 'indisponivel'); end if;

  select count(*)::integer into v_ativos from public.qf_desbloqueios d
   where d.chamado_id = p_chamado_id and coalesce(d.ativo, true);
  if v_ativos >= 1 then
    return jsonb_build_object('ok', false, 'reason', 'reservado', 'lotado', true, 'participantes', v_ativos, 'limite', 1);
  end if;

  if not exists (select 1 from public.qf_listar_chamados_disponiveis() d where d.id = p_chamado_id) then
    return jsonb_build_object('ok', false, 'reason', 'nao_elegivel');
  end if;

  v_taxa := public.qf_taxa_indicacao_centavos(c.categoria, c.valor_oferecido_centavos);
  if p_taxa_confirmada_centavos is not null and p_taxa_confirmada_centavos <> v_taxa then
    return jsonb_build_object('ok', false, 'reason', 'taxa_mudou', 'taxa_centavos', v_taxa,
                              'valor_centavos', c.valor_oferecido_centavos);
  end if;

  if v_taxa > 0 then
    insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
    values (v_prof, 0, 0, true) on conflict (profissional_id) do update set bonus_inicial_usado = true;
    perform private.qf_expirar_bonus_profissional(v_prof);
    select saldo_centavos into v_saldo from public.qf_carteiras where profissional_id = v_prof for update;
    if coalesce(v_saldo, 0) < v_taxa then
      return jsonb_build_object('ok', false, 'reason', 'saldo_insuficiente', 'taxa_centavos', v_taxa,
                                'saldo_centavos', coalesce(v_saldo, 0), 'falta_centavos', v_taxa - coalesce(v_saldo, 0),
                                'valor_centavos', c.valor_oferecido_centavos);
    end if;
    update public.qf_carteiras set saldo_centavos = saldo_centavos - v_taxa, atualizado_em = now()
     where profissional_id = v_prof;
    insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
    values (v_prof, 'debito', v_taxa, 'chamado', p_chamado_id, 'Taxa de indicação (pedido com valor definido)');
  else
    v_saldo := 0;
  end if;

  perform set_config('qf.valor_unlock', '1', true);
  insert into public.qf_desbloqueios (chamado_id, profissional_id, valor_centavos, origem, ativo, exclusivo)
  values (p_chamado_id, v_prof, v_taxa, 'saldo', true, false);
  perform set_config('qf.valor_unlock', '', true);

  update public.qf_chamados set status = 'em_negociacao', atualizado_em = now() where id = p_chamado_id;
  perform private.qf_push_interno('professional_connected', p_chamado_id);
  perform private.qf_evento(p_chamado_id, 'desbloqueio_valor', v_prof, 'profissional',
    jsonb_build_object('taxa_centavos', v_taxa, 'valor_oferecido_centavos', c.valor_oferecido_centavos));

  return jsonb_build_object('ok', true, 'taxa_centavos', v_taxa, 'valor_centavos', c.valor_oferecido_centavos,
                            'saldo_centavos', coalesce(v_saldo, 0) - v_taxa, 'participantes', 1, 'limite', 1);
end $$;
revoke all on function public.qf_desbloquear_chamado_valor(uuid, integer) from public, anon;
grant execute on function public.qf_desbloquear_chamado_valor(uuid, integer) to authenticated;

-- Informações do pedido de valor definido para quem pode ver o pedido (sem nenhum dado pessoal).
create or replace function public.qf_valor_info_chamados(p_ids uuid[])
returns table (chamado_id uuid, modalidade text, valor_oferecido_centavos integer, material_incluso boolean,
               taxa_centavos integer, rotulo text, vagas integer)
language sql stable security definer set search_path = '' as $$
  select c.id, c.modalidade, c.valor_oferecido_centavos, c.material_incluso,
         public.qf_taxa_indicacao_centavos(c.categoria, c.valor_oferecido_centavos),
         'Valor confirmado pelo cliente'::text,
         greatest(0, 1 - (select count(*)::integer from public.qf_desbloqueios d where d.chamado_id = c.id and coalesce(d.ativo, true)))
    from public.qf_chamados c
   where c.id = any (p_ids[1:100])
     and c.modalidade = 'valor_definido'
     and auth.uid() is not null
     and (
       c.cliente_id = auth.uid()
       or private.qf_is_admin()
       or exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = auth.uid())
       -- Profissional que enxerga o pedido nas listas (vitrine, "outros pedidos") vê valor e taxa: não há dado pessoal aqui.
       -- Quem pode DESBLOQUEAR continua sendo decidido só por qf_desbloquear_chamado_valor (profissão + raio).
       or (c.status in ('aberto', 'em_negociacao') and exists (select 1 from public.qf_profissionais pf where pf.user_id = auth.uid()))
     );
$$;
revoke all on function public.qf_valor_info_chamados(uuid[]) from public, anon;
grant execute on function public.qf_valor_info_chamados(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6) Cancelamento por imprevisto (cliente)
-- ---------------------------------------------------------------------------------------------
create table if not exists public.qf_cancelamentos_pedido (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null unique,
  cliente_id uuid not null,
  motivo text not null check (motivo in ('imprevisto', 'financeiro', 'nao_precisa_mais', 'nao_combinou', 'outro')),
  detalhe text,
  status_anterior text,
  houve_desbloqueio boolean not null default false,
  desbloqueios jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists qf_cancelamentos_pedido_cliente_idx on public.qf_cancelamentos_pedido (cliente_id, criado_em desc);
alter table public.qf_cancelamentos_pedido enable row level security;
revoke all on public.qf_cancelamentos_pedido from anon, authenticated;

create or replace function public.qf_cliente_cancelar_pedido(p_chamado_id uuid, p_motivo text, p_detalhe text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  c public.qf_chamados%rowtype;
  v_lista jsonb;
  v_rotulo text;
  r record;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_motivo is null or p_motivo not in ('imprevisto', 'financeiro', 'nao_precisa_mais', 'nao_combinou', 'outro') then
    return jsonb_build_object('ok', false, 'reason', 'motivo_invalido');
  end if;
  if p_motivo = 'outro' and char_length(trim(coalesce(p_detalhe, ''))) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'detalhe_obrigatorio');
  end if;
  if char_length(coalesce(p_detalhe, '')) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'detalhe_longo');
  end if;

  select * into c from public.qf_chamados where id = p_chamado_id for update;
  if not found or c.cliente_id <> v_uid then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  if c.status not in ('aberto', 'em_negociacao', 'aguardando_pagamento') then
    return jsonb_build_object('ok', false, 'reason', 'status_invalido', 'status', c.status);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('desbloqueio_id', d.id, 'profissional_id', d.profissional_id,
                                               'valor_centavos', d.valor_centavos)), '[]'::jsonb)
    into v_lista
    from public.qf_desbloqueios d where d.chamado_id = p_chamado_id and coalesce(d.ativo, true);

  insert into public.qf_cancelamentos_pedido (chamado_id, cliente_id, motivo, detalhe, status_anterior, houve_desbloqueio, desbloqueios)
  values (p_chamado_id, v_uid, p_motivo, nullif(trim(coalesce(p_detalhe, '')), ''), c.status, jsonb_array_length(v_lista) > 0, v_lista);

  update public.qf_chamados set status = 'cancelado', atualizado_em = now() where id = p_chamado_id;

  v_rotulo := case p_motivo when 'imprevisto' then 'imprevisto pessoal ou familiar'
                            when 'financeiro' then 'problema financeiro'
                            when 'nao_precisa_mais' then 'serviço não é mais necessário'
                            when 'nao_combinou' then 'não conseguiu combinar com o profissional'
                            else 'outro motivo' end;
  for r in select (x->>'profissional_id')::uuid as prof from jsonb_array_elements(v_lista) x loop
    insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
    values (r.prof, p_chamado_id, 'pedido_cancelado', 'Pedido cancelado pelo cliente',
            'O cliente cancelou o pedido (' || v_rotulo || '). O crédito segue a regra do desbloqueio. '
            || 'Se o contato era falso ou inválido, abra uma contestação na Carteira.', '/profissional/carteira')
    on conflict (user_id, chamado_id, tipo) do nothing;
  end loop;

  perform private.qf_evento(p_chamado_id, 'cancelado_cliente', v_uid, 'cliente',
    jsonb_build_object('motivo', p_motivo, 'houve_desbloqueio', jsonb_array_length(v_lista) > 0, 'profissionais', jsonb_array_length(v_lista)));

  return jsonb_build_object('ok', true, 'houve_desbloqueio', jsonb_array_length(v_lista) > 0,
                            'profissionais_avisados', jsonb_array_length(v_lista));
end $$;
revoke all on function public.qf_cliente_cancelar_pedido(uuid, text, text) from public, anon;
grant execute on function public.qf_cliente_cancelar_pedido(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7) Baixa do serviço com confirmação do cliente (QR Code / link seguro) e avaliação
-- ---------------------------------------------------------------------------------------------
create table if not exists public.qf_conclusoes (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null,
  desbloqueio_id uuid,
  profissional_id uuid not null,
  cliente_id uuid not null,
  token_hash text not null,                                   -- só o hash (sha256) do token; o token real aparece uma vez
  expira_em timestamptz not null,
  status text not null default 'pendente'
    check (status in ('pendente', 'concluido', 'com_problema', 'nao_realizado', 'substituida', 'encerrada_admin')),
  nota smallint check (nota between 1 and 5),
  comentario text,
  problema_descricao text,
  respondida_em timestamptz,
  respondida_por uuid,
  evidencias_admin text,
  encerrada_por uuid,
  encerrada_em timestamptz,
  criado_em timestamptz not null default now(),
  check (status <> 'concluido' or nota is not null)
);
create unique index if not exists qf_conclusoes_uma_pendente_idx on public.qf_conclusoes (chamado_id, profissional_id) where status = 'pendente';
create index if not exists qf_conclusoes_cliente_idx on public.qf_conclusoes (cliente_id, status);
create index if not exists qf_conclusoes_token_idx on public.qf_conclusoes (token_hash);
alter table public.qf_conclusoes enable row level security;
revoke all on public.qf_conclusoes from anon, authenticated;

create or replace function public.qf_solicitar_baixa(p_chamado_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_prof uuid := auth.uid();
  cfg jsonb := private.qf_valor_cfg();
  c public.qf_chamados%rowtype;
  d public.qf_desbloqueios%rowtype;
  v_raw text; v_id uuid; v_exp timestamptz;
begin
  if v_prof is null then raise exception 'authentication required'; end if;
  if not coalesce((cfg->>'ativo')::boolean, false) then return jsonb_build_object('ok', false, 'reason', 'desativado'); end if;
  select * into c from public.qf_chamados where id = p_chamado_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'chamado_nao_encontrado'); end if;
  if c.cliente_id = v_prof then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  select * into d from public.qf_desbloqueios where chamado_id = p_chamado_id and profissional_id = v_prof and coalesce(ativo, true);
  if not found then return jsonb_build_object('ok', false, 'reason', 'sem_desbloqueio'); end if;
  if c.status not in ('em_negociacao', 'confirmado', 'em_andamento') then
    return jsonb_build_object('ok', false, 'reason', 'status_invalido', 'status', c.status);
  end if;
  if (select count(*) from public.qf_conclusoes k where k.chamado_id = p_chamado_id and k.profissional_id = v_prof
         and k.criado_em > now() - interval '1 day') >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'limite');
  end if;

  update public.qf_conclusoes set status = 'substituida'
   where chamado_id = p_chamado_id and profissional_id = v_prof and status = 'pendente';

  v_raw := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp := now() + make_interval(days => (cfg->>'conclusao_validade_dias')::integer);
  insert into public.qf_conclusoes (chamado_id, desbloqueio_id, profissional_id, cliente_id, token_hash, expira_em)
  values (p_chamado_id, d.id, v_prof, c.cliente_id, encode(sha256(convert_to(v_raw, 'utf8')), 'hex'), v_exp)
  returning id into v_id;

  perform private.qf_evento(p_chamado_id, 'baixa_solicitada', v_prof, 'profissional', jsonb_build_object('conclusao_id', v_id));
  return jsonb_build_object('ok', true, 'conclusao_id', v_id, 'token', v_raw, 'expira_em', v_exp);
end $$;
revoke all on function public.qf_solicitar_baixa(uuid) from public, anon;
grant execute on function public.qf_solicitar_baixa(uuid) to authenticated;

-- Pendências do CLIENTE logado. Filtra por token do link ou por QR da carteirinha, sempre só os pedidos dele.
create or replace function public.qf_cliente_conclusoes_pendentes(p_token text default null, p_carteirinha uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_prof uuid; v_hash text; v_itens jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'login_necessario'); end if;
  if p_carteirinha is not null then
    select c.profissional_id into v_prof from public.qf_carteirinhas c where c.token = p_carteirinha;
    if v_prof is null then return jsonb_build_object('ok', false, 'reason', 'indisponivel'); end if;
  end if;
  if p_token is not null then v_hash := encode(sha256(convert_to(p_token, 'utf8')), 'hex'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'conclusao_id', k.id, 'chamado_id', k.chamado_id, 'categoria', c.categoria, 'cidade', c.cidade,
           'profissional_id', k.profissional_id,
           'profissional', coalesce(nullif(p.nome_fantasia, ''), p.nome), 'foto', p.foto_url,
           'expira_em', k.expira_em) order by k.criado_em desc), '[]'::jsonb)
    into v_itens
    from public.qf_conclusoes k
    join public.qf_chamados c on c.id = k.chamado_id
    join public.qf_profiles p on p.id = k.profissional_id
   where k.cliente_id = v_uid and k.status = 'pendente' and k.expira_em > now()
     and (v_prof is null or k.profissional_id = v_prof)
     and (v_hash is null or k.token_hash = v_hash);
  return jsonb_build_object('ok', true, 'itens', v_itens);
end $$;
revoke all on function public.qf_cliente_conclusoes_pendentes(text, uuid) from public, anon;
grant execute on function public.qf_cliente_conclusoes_pendentes(text, uuid) to authenticated;

create or replace function public.qf_conclusao_responder(
  p_conclusao_id uuid, p_resposta text, p_nota integer default null,
  p_comentario text default null, p_problema text default null, p_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  k public.qf_conclusoes%rowtype;
  c public.qf_chamados%rowtype;
  v_media numeric; v_total integer;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_resposta is null or p_resposta not in ('concluido', 'com_problema', 'nao_realizado') then
    return jsonb_build_object('ok', false, 'reason', 'resposta_invalida');
  end if;
  if char_length(coalesce(p_comentario, '')) > 500 or char_length(coalesce(p_problema, '')) > 800 then
    return jsonb_build_object('ok', false, 'reason', 'texto_longo');
  end if;

  select * into k from public.qf_conclusoes where id = p_conclusao_id for update;
  -- Só o cliente dono do pedido responde. Profissional (inclusive o responsável) nunca confirma por ele.
  if not found or k.cliente_id <> v_uid or k.profissional_id = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if p_token is not null and k.token_hash <> encode(sha256(convert_to(p_token, 'utf8')), 'hex') then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if k.status <> 'pendente' then return jsonb_build_object('ok', false, 'reason', 'ja_respondida', 'status', k.status); end if;
  if k.expira_em <= now() then return jsonb_build_object('ok', false, 'reason', 'expirada'); end if;

  select * into c from public.qf_chamados where id = k.chamado_id for update;

  if p_resposta = 'concluido' then
    if p_nota is null or p_nota < 1 or p_nota > 5 then return jsonb_build_object('ok', false, 'reason', 'nota_invalida'); end if;
    update public.qf_conclusoes
       set status = 'concluido', nota = p_nota, comentario = nullif(trim(coalesce(p_comentario, '')), ''),
           respondida_em = now(), respondida_por = v_uid
     where id = k.id;
    update public.qf_chamados set status = 'concluido', desfecho = coalesce(desfecho, 'fechado'), desfecho_em = coalesce(desfecho_em, now()),
           atualizado_em = now()
     where id = k.chamado_id and status in ('em_negociacao', 'confirmado', 'em_andamento');
    update public.qf_desbloqueios set desfecho = coalesce(desfecho, 'fechado'), desfecho_em = coalesce(desfecho_em, now()) where id = k.desbloqueio_id;
    -- Avaliação genuína do cliente, gravada para o profissional desta baixa (não para "o último que desbloqueou").
    insert into public.qf_avaliacoes (chamado_id, cliente_id, profissional_id, nota, comentario, autor_tipo)
    values (k.chamado_id, k.cliente_id, k.profissional_id, p_nota, nullif(trim(coalesce(p_comentario, '')), ''), 'cliente')
    on conflict (chamado_id, autor_tipo) do update set nota = excluded.nota, comentario = excluded.comentario, criado_em = now();
    select coalesce(avg(a.nota), 0), count(*)::integer into v_media, v_total
      from public.qf_avaliacoes a where a.profissional_id = k.profissional_id and a.autor_tipo = 'cliente';
    update public.qf_profissionais set avaliacao_media = round(v_media, 2), total_avaliacoes = v_total, atualizado_em = now()
     where user_id = k.profissional_id;
  elsif p_resposta = 'com_problema' then
    if char_length(trim(coalesce(p_problema, ''))) < 5 then return jsonb_build_object('ok', false, 'reason', 'problema_obrigatorio'); end if;
    update public.qf_conclusoes
       set status = 'com_problema', problema_descricao = trim(p_problema), comentario = nullif(trim(coalesce(p_comentario, '')), ''),
           respondida_em = now(), respondida_por = v_uid
     where id = k.id;
  else
    update public.qf_conclusoes
       set status = 'nao_realizado', comentario = nullif(trim(coalesce(p_comentario, '')), ''),
           respondida_em = now(), respondida_por = v_uid
     where id = k.id;
  end if;

  perform private.qf_evento(k.chamado_id, 'conclusao_' || p_resposta, v_uid, 'cliente',
    jsonb_build_object('conclusao_id', k.id, 'profissional_id', k.profissional_id, 'nota', p_nota));
  return jsonb_build_object('ok', true, 'resposta', p_resposta);
end $$;
revoke all on function public.qf_conclusao_responder(uuid, text, integer, text, text, text) from public, anon;
grant execute on function public.qf_conclusao_responder(uuid, text, integer, text, text, text) to authenticated;

-- Encerramento administrativo: nunca cria avaliação nem muda o status do pedido (o cliente não vira "pendente de avaliar").
create or replace function public.qf_admin_encerrar_conclusao(p_conclusao_id uuid, p_evidencias text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k public.qf_conclusoes%rowtype;
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  if char_length(trim(coalesce(p_evidencias, ''))) < 10 then return jsonb_build_object('ok', false, 'reason', 'evidencias_obrigatorias'); end if;
  select * into k from public.qf_conclusoes where id = p_conclusao_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nao_encontrada'); end if;
  if k.status not in ('pendente', 'com_problema', 'nao_realizado') then
    return jsonb_build_object('ok', false, 'reason', 'status_invalido', 'status', k.status);
  end if;
  update public.qf_conclusoes set status = 'encerrada_admin', evidencias_admin = trim(p_evidencias),
         encerrada_por = auth.uid(), encerrada_em = now() where id = k.id;
  perform private.qf_evento(k.chamado_id, 'conclusao_encerrada_admin', auth.uid(), 'admin',
    jsonb_build_object('conclusao_id', k.id, 'status_anterior', k.status));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.qf_admin_encerrar_conclusao(uuid, text) from public, anon;
grant execute on function public.qf_admin_encerrar_conclusao(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8) Contestação de desbloqueio (profissional) e decisão do admin
-- ---------------------------------------------------------------------------------------------
create table if not exists public.qf_contestacoes_desbloqueio (
  id uuid primary key default gen_random_uuid(),
  desbloqueio_id uuid not null unique,
  chamado_id uuid not null,
  profissional_id uuid not null,
  motivo text not null check (motivo in ('contato_falso', 'contato_invalido', 'cliente_cancelou', 'outro')),
  descricao text not null,
  evidencias text,
  status text not null default 'pendente' check (status in ('pendente', 'aceita', 'negada')),
  decisao_nota text,
  valor_estornado_centavos integer,
  criado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por uuid
);
create index if not exists qf_contestacoes_status_idx on public.qf_contestacoes_desbloqueio (status, criado_em);
alter table public.qf_contestacoes_desbloqueio enable row level security;
revoke all on public.qf_contestacoes_desbloqueio from anon, authenticated;

create or replace function public.qf_contestar_desbloqueio(p_desbloqueio_id uuid, p_motivo text, p_descricao text, p_evidencias text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); d public.qf_desbloqueios%rowtype; v_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_motivo is null or p_motivo not in ('contato_falso', 'contato_invalido', 'cliente_cancelou', 'outro') then
    return jsonb_build_object('ok', false, 'reason', 'motivo_invalido');
  end if;
  if char_length(trim(coalesce(p_descricao, ''))) < 10 then return jsonb_build_object('ok', false, 'reason', 'descricao_obrigatoria'); end if;
  if char_length(coalesce(p_descricao, '')) > 1000 or char_length(coalesce(p_evidencias, '')) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'texto_longo');
  end if;
  select * into d from public.qf_desbloqueios where id = p_desbloqueio_id;
  if not found or d.profissional_id <> v_uid then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  if d.criado_em < now() - make_interval(days => (private.qf_valor_cfg()->>'contestacao_dias')::integer) then
    return jsonb_build_object('ok', false, 'reason', 'prazo_encerrado');
  end if;
  insert into public.qf_contestacoes_desbloqueio (desbloqueio_id, chamado_id, profissional_id, motivo, descricao, evidencias)
  values (d.id, d.chamado_id, v_uid, p_motivo, trim(p_descricao), nullif(trim(coalesce(p_evidencias, '')), ''))
  on conflict (desbloqueio_id) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'ja_contestado'); end if;
  perform private.qf_evento(d.chamado_id, 'contestacao_aberta', v_uid, 'profissional',
    jsonb_build_object('contestacao_id', v_id, 'motivo', p_motivo));
  return jsonb_build_object('ok', true, 'contestacao_id', v_id);
end $$;
revoke all on function public.qf_contestar_desbloqueio(uuid, text, text, text) from public, anon;
grant execute on function public.qf_contestar_desbloqueio(uuid, text, text, text) to authenticated;

create or replace function public.qf_admin_resolver_contestacao(p_id uuid, p_decisao text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.qf_contestacoes_desbloqueio%rowtype; d public.qf_desbloqueios%rowtype; v_valor integer := 0; v_novo text;
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  if p_decisao not in ('estornar', 'negar') then return jsonb_build_object('ok', false, 'reason', 'decisao_invalida'); end if;
  if char_length(trim(coalesce(p_nota, ''))) < 5 then return jsonb_build_object('ok', false, 'reason', 'nota_obrigatoria'); end if;
  select * into t from public.qf_contestacoes_desbloqueio where id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'nao_encontrada'); end if;
  if t.status <> 'pendente' then return jsonb_build_object('ok', false, 'reason', 'ja_decidida', 'status', t.status); end if;

  if p_decisao = 'estornar' then
    select * into d from public.qf_desbloqueios where id = t.desbloqueio_id for update;
    v_valor := coalesce(d.valor_centavos, 0);
    if v_valor > 0 and d.origem = 'saldo' then
      insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
      values (d.profissional_id, 0, 0, true) on conflict (profissional_id) do nothing;
      update public.qf_carteiras set saldo_centavos = saldo_centavos + v_valor, atualizado_em = now() where profissional_id = d.profissional_id;
      insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (d.profissional_id, 'estorno', v_valor, 'contestacao', t.id, 'Estorno de desbloqueio após análise da contestação');
    else
      v_valor := 0;
    end if;
    update public.qf_desbloqueios set ativo = false where id = d.id;
    -- sem outro profissional ativo, o pedido volta a ficar aberto (mesma regra do cancelamento pelo profissional)
    if not exists (select 1 from public.qf_desbloqueios x where x.chamado_id = t.chamado_id and coalesce(x.ativo, true)) then
      update public.qf_chamados set status = 'aberto', atualizado_em = now() where id = t.chamado_id and status = 'em_negociacao';
    end if;
  end if;

  v_novo := case when p_decisao = 'estornar' then 'aceita' else 'negada' end;
  update public.qf_contestacoes_desbloqueio
     set status = v_novo, decisao_nota = trim(p_nota), valor_estornado_centavos = v_valor,
         decidido_em = now(), decidido_por = auth.uid()
   where id = t.id;
  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  values (t.profissional_id, t.chamado_id, 'contestacao_decidida',
          case when v_novo = 'aceita' then 'Contestação aceita' else 'Contestação analisada' end,
          case when v_novo = 'aceita' then 'Analisamos as evidências e o valor foi devolvido à sua carteira.'
               else 'Analisamos as evidências e o desbloqueio foi mantido. Veja a justificativa no painel.' end,
          '/profissional/carteira')
  on conflict (user_id, chamado_id, tipo) do update set titulo = excluded.titulo, corpo = excluded.corpo, criado_em = now();
  perform private.qf_evento(t.chamado_id, 'contestacao_' || v_novo, auth.uid(), 'admin',
    jsonb_build_object('contestacao_id', t.id, 'valor_estornado_centavos', v_valor));
  return jsonb_build_object('ok', true, 'status', v_novo, 'valor_estornado_centavos', v_valor);
end $$;
revoke all on function public.qf_admin_resolver_contestacao(uuid, text, text) from public, anon;
grant execute on function public.qf_admin_resolver_contestacao(uuid, text, text) to authenticated;

-- Pedidos de valor definido nunca recebem devolução automática (a de lead continua desligada por qf_config).
-- Única função existente reescrita: igual à de produção, com a guarda marcada abaixo.
create or replace function qf_private.devolver_lead(p_desbloqueio_id uuid, p_motivo text)
returns integer language plpgsql security definer set search_path = '' as $function$
declare d public.qf_desbloqueios; v_id uuid; v_txt text; v_preco integer;
begin
  -- V11.21: devolução desligada pela chave devolucao_lead em qf_config.
  if not coalesce((select (c.valor->>'ativo')::boolean from public.qf_config c where c.chave = 'devolucao_lead'), true) then return 0; end if;
  -- GUARDA (pedidos com valor definido): estorno só pela contestação analisada por um administrador.
  if exists (select 1 from public.qf_desbloqueios x join public.qf_chamados ch on ch.id = x.chamado_id
              where x.id = p_desbloqueio_id and ch.modalidade = 'valor_definido') then return 0; end if;
  select * into d from public.qf_desbloqueios where id = p_desbloqueio_id for update;
  if d.id is null then return 0; end if;
  v_txt := case p_motivo when 'cliente_cancelou' then 'Devolução do lead: o cliente cancelou o pedido'
                         when 'chamado_expirou' then 'Devolução do lead: o pedido expirou'
                         else 'Devolução do lead: o cliente não respondeu' end;
  if d.origem = 'plano' then
    if not d.ativo or d.plano_id is null then return 0; end if;
    select coalesce(p.preco_centavos, padrao.preco_centavos, 790) into v_preco
      from public.qf_chamados c
      left join public.qf_precos_desbloqueio p on p.categoria = c.categoria and p.ativo
      left join public.qf_precos_desbloqueio padrao on padrao.categoria = 'padrao'
     where c.id = d.chamado_id;
    insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo)
    values (d.id, d.chamado_id, d.profissional_id, coalesce(v_preco, 790), p_motivo)
    on conflict (desbloqueio_id) do nothing returning id into v_id;
    if v_id is null then return 0; end if;
    update public.qf_planos_profissional
       set chamados_restantes = chamados_restantes + 1,
           valido_ate = greatest(valido_ate, now() + interval '7 days'),
           atualizado_em = now()
     where id = d.plano_id;
    update public.qf_desbloqueios set ativo = false where id = d.id;
    insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
    values (d.profissional_id, d.chamado_id, 'lead_devolvido', 'Chamado devolvido ao seu plano',
            v_txt || '. 1 chamado voltou para o seu plano.', '/profissional/carteira')
    on conflict (user_id, chamado_id, tipo) do nothing;
    return 1;
  end if;
  if coalesce(d.valor_centavos, 0) <= 0 or d.origem <> 'saldo' then return 0; end if;
  if not exists (select 1 from public.qf_movimentacoes_carteira m where m.profissional_id = d.profissional_id
                 and m.tipo = 'debito' and m.referencia_tipo = 'chamado' and m.referencia_id = d.chamado_id) then return 0; end if;
  insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo)
  values (d.id, d.chamado_id, d.profissional_id, d.valor_centavos, p_motivo)
  on conflict (desbloqueio_id) do nothing returning id into v_id;
  if v_id is null then return 0; end if;
  insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (d.profissional_id, 0, 0, true) on conflict (profissional_id) do nothing;
  update public.qf_carteiras set saldo_centavos = saldo_centavos + d.valor_centavos, atualizado_em = now()
   where profissional_id = d.profissional_id;
  insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (d.profissional_id, 'estorno', d.valor_centavos, 'chamado', d.chamado_id, v_txt);
  update public.qf_desbloqueios set ativo = false where id = d.id;
  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  values (d.profissional_id, d.chamado_id, 'lead_devolvido', 'Crédito devolvido',
          v_txt || '. R$ ' || replace(to_char(d.valor_centavos / 100.0, 'FM999990.00'), '.', ',') || ' voltaram para a sua carteira.', '/profissional/carteira')
  on conflict (user_id, chamado_id, tipo) do nothing;
  return d.valor_centavos;
end $function$;

-- ---------------------------------------------------------------------------------------------
-- 9) Painel administrativo
-- ---------------------------------------------------------------------------------------------
create or replace function public.qf_admin_pedidos_valor(p_modalidade text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  select coalesce(jsonb_agg(row_to_json(q)::jsonb order by q.criado_em desc), '[]'::jsonb) into v
  from (
    select c.id, c.categoria, c.cidade, c.uf, c.status, c.modalidade, c.valor_oferecido_centavos, c.material_incluso, c.criado_em,
      (select jsonb_agg(jsonb_build_object(
          'desbloqueio_id', d.id, 'profissional_id', d.profissional_id,
          'profissional', coalesce(nullif(pr.nome_fantasia, ''), pr.nome), 'taxa_centavos', d.valor_centavos,
          'origem', d.origem, 'ativo', d.ativo, 'criado_em', d.criado_em,
          'pagamento_confirmado', (d.valor_centavos = 0 or exists (select 1 from public.qf_movimentacoes_carteira m
              where m.profissional_id = d.profissional_id and m.tipo = 'debito' and m.referencia_tipo = 'chamado' and m.referencia_id = d.chamado_id))))
         from public.qf_desbloqueios d left join public.qf_profiles pr on pr.id = d.profissional_id where d.chamado_id = c.id) as desbloqueios,
      (select jsonb_build_object('id', k.id, 'status', k.status, 'nota', k.nota, 'respondida_em', k.respondida_em, 'expira_em', k.expira_em, 'criado_em', k.criado_em)
         from public.qf_conclusoes k where k.chamado_id = c.id order by k.criado_em desc limit 1) as conclusao,
      (select jsonb_build_object('motivo', x.motivo, 'detalhe', x.detalhe, 'houve_desbloqueio', x.houve_desbloqueio, 'criado_em', x.criado_em)
         from public.qf_cancelamentos_pedido x where x.chamado_id = c.id) as cancelamento,
      (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'status', t.status, 'motivo', t.motivo, 'descricao', t.descricao,
                'valor_estornado_centavos', t.valor_estornado_centavos, 'criado_em', t.criado_em)), '[]'::jsonb)
         from public.qf_contestacoes_desbloqueio t where t.chamado_id = c.id) as contestacoes
    from public.qf_chamados c
    where (p_modalidade is null or c.modalidade = p_modalidade)
    order by c.criado_em desc
    limit greatest(1, least(coalesce(p_limit, 100), 500)) offset greatest(0, coalesce(p_offset, 0))
  ) q;
  return v;
end $$;
revoke all on function public.qf_admin_pedidos_valor(text, integer, integer) from public, anon;
grant execute on function public.qf_admin_pedidos_valor(text, integer, integer) to authenticated;

create or replace function public.qf_admin_pedido_historico(p_chamado_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tipo', e.tipo, 'ator_id', e.ator_id, 'ator_papel', e.ator_papel,
                   'dados', e.dados, 'criado_em', e.criado_em) order by e.criado_em, e.id)
                   from public.qf_pedido_eventos e where e.chamado_id = p_chamado_id), '[]'::jsonb);
end $$;
revoke all on function public.qf_admin_pedido_historico(uuid) from public, anon;
grant execute on function public.qf_admin_pedido_historico(uuid) to authenticated;

create or replace function public.qf_admin_taxas_indicacao()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return jsonb_build_object(
    'config', private.qf_valor_cfg(),
    'taxas', coalesce((select jsonb_agg(jsonb_build_object('categoria', t.categoria, 'percentual_bps', t.percentual_bps,
                'teto_centavos', t.teto_centavos, 'ativo', t.ativo) order by (t.categoria = 'padrao') desc, t.categoria)
                from public.qf_taxas_indicacao t), '[]'::jsonb));
end $$;
revoke all on function public.qf_admin_taxas_indicacao() from public, anon;
grant execute on function public.qf_admin_taxas_indicacao() to authenticated;

create or replace function public.qf_admin_salvar_taxa_indicacao(p_categoria text, p_percentual_bps integer, p_teto_centavos integer default null, p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  if nullif(trim(coalesce(p_categoria, '')), '') is null then return jsonb_build_object('ok', false, 'reason', 'categoria_obrigatoria'); end if;
  if p_percentual_bps is null or p_percentual_bps < 0 or p_percentual_bps > 5000 then return jsonb_build_object('ok', false, 'reason', 'percentual_invalido'); end if;
  if p_teto_centavos is not null and p_teto_centavos < 0 then return jsonb_build_object('ok', false, 'reason', 'teto_invalido'); end if;
  insert into public.qf_taxas_indicacao (categoria, percentual_bps, teto_centavos, ativo, atualizado_em, atualizado_por)
  values (trim(p_categoria), p_percentual_bps, p_teto_centavos, coalesce(p_ativo, true), now(), auth.uid())
  on conflict (categoria) do update set percentual_bps = excluded.percentual_bps, teto_centavos = excluded.teto_centavos,
    ativo = excluded.ativo, atualizado_em = now(), atualizado_por = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean) from public, anon;
grant execute on function public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean) to authenticated;

-- Liga/desliga as novas funcionalidades (publicação só depois da revisão final).
create or replace function public.qf_admin_pedidos_valor_ativar(p_ativo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  insert into public.qf_config (chave, valor, atualizado_em)
  values ('pedidos_valor_definido', private.qf_valor_cfg() || jsonb_build_object('ativo', coalesce(p_ativo, false)), now())
  on conflict (chave) do update set valor = public.qf_config.valor || jsonb_build_object('ativo', coalesce(p_ativo, false)), atualizado_em = now();
  return jsonb_build_object('ok', true, 'ativo', coalesce(p_ativo, false));
end $$;
revoke all on function public.qf_admin_pedidos_valor_ativar(boolean) from public, anon;
grant execute on function public.qf_admin_pedidos_valor_ativar(boolean) to authenticated;

-- Cancelamentos repetitivos: só LISTA para revisão humana. Não bloqueia nem pune ninguém automaticamente.
create or replace function public.qf_admin_cancelamentos_suspeitos(p_dias integer default 30, p_minimo integer default 3)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'admin authentication required'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(q)::jsonb order by q.total desc)
    from (
      select x.cliente_id, coalesce(pr.nome, '') as cliente, count(*)::integer as total,
             count(*) filter (where x.houve_desbloqueio)::integer as com_desbloqueio,
             jsonb_agg(distinct x.motivo) as motivos, max(x.criado_em) as ultimo
        from public.qf_cancelamentos_pedido x left join public.qf_profiles pr on pr.id = x.cliente_id
       where x.criado_em > now() - make_interval(days => greatest(1, coalesce(p_dias, 30)))
       group by x.cliente_id, pr.nome
      having count(*) filter (where x.houve_desbloqueio) >= greatest(1, coalesce(p_minimo, 3))
    ) q), '[]'::jsonb);
end $$;
revoke all on function public.qf_admin_cancelamentos_suspeitos(integer, integer) from public, anon;
grant execute on function public.qf_admin_cancelamentos_suspeitos(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 10) Carteirinha: dados públicos com profissão (a função antiga continua igual)
-- ---------------------------------------------------------------------------------------------
create or replace function public.qf_carteirinha_publica_v2(p_token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'nome', coalesce(nullif(p.nome_fantasia, ''), p.nome), 'foto', p.foto_url,
             'numero', 'QF-' || lpad(c.numero::text, 6, '0'),
             'especialidades', to_jsonb(coalesce(pf.especialidades, '{}'::text[])))
      from public.qf_carteirinhas c
      join public.qf_profiles p on p.id = c.profissional_id
      left join public.qf_profissionais pf on pf.user_id = c.profissional_id
     where c.token = p_token and p.ativo = true and p.tipo = 'profissional'
  ), jsonb_build_object('ok', false, 'reason', 'indisponivel'));
$$;
revoke all on function public.qf_carteirinha_publica_v2(uuid) from public;
grant execute on function public.qf_carteirinha_publica_v2(uuid) to anon, authenticated;
