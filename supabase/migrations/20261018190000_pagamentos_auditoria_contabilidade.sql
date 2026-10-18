-- QuemFaz — recargas, planos e contabilidade administrativa (18/10/2026)
--
-- O que esta migration faz:
--   1. Cria o registro de processamento de pagamentos (qf_pagamento_eventos).
--   2. Centraliza a entrega do benefício (crédito OU plano) numa função idempotente e corrige uma falha:
--      pagamento de PLANO que não encontrava o plano no catálogo era creditado como SALDO. Agora nunca vira saldo.
--   3. Falha ao entregar o benefício deixa de ser silenciosa: o pagamento continua aprovado, o erro é registrado
--      e a reconciliação (a cada 5 minutos) tenta de novo. Nada é creditado duas vezes.
--   4. Cria o painel de contabilidade (qf_admin_contabilidade) e a reconciliação para o administrador.
--   5. Ajuste manual de saldo passa a deixar trilha (quem, quanto, saldo antes/depois) e o ajuste negativo,
--      que sempre falhava, passa a funcionar sem deixar o saldo negativo.
--
-- Não altera nenhum pagamento, saldo ou plano já existente. Segura para rodar mais de uma vez.

------------------------------------------------------------------------------------------------------
-- 1. Registro de processamento
------------------------------------------------------------------------------------------------------
create table if not exists public.qf_pagamento_eventos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  tabela text not null default 'qf_recargas',
  referencia_id uuid,
  profissional_id uuid,
  evento text not null,
  detalhe jsonb not null default '{}'::jsonb
);
alter table public.qf_pagamento_eventos enable row level security;
revoke all on public.qf_pagamento_eventos from anon, authenticated;
create index if not exists qf_pagamento_eventos_ref_idx on public.qf_pagamento_eventos (referencia_id, criado_em desc);
create index if not exists qf_pagamento_eventos_evento_idx on public.qf_pagamento_eventos (evento, criado_em desc);

create or replace function private.qf_log_pagamento(p_ref uuid, p_prof uuid, p_evento text, p_detalhe jsonb default '{}'::jsonb, p_tabela text default 'qf_recargas')
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.qf_pagamento_eventos(tabela, referencia_id, profissional_id, evento, detalhe)
  values (p_tabela, p_ref, p_prof, p_evento, coalesce(p_detalhe, '{}'::jsonb));
exception when others then
  -- o registro nunca pode derrubar o pagamento
  raise warning 'QuemFaz log de pagamento: %', sqlerrm;
end;
$$;

-- Cada recarga de crédito gera no máximo um bônus de recarga (a regra já existia no gatilho; aqui o banco também impede).
create unique index if not exists qf_mov_bonus_recarga_unico
  on public.qf_movimentacoes_carteira (referencia_id)
  where referencia_tipo = 'bonus_recarga' and tipo = 'bonus' and referencia_id is not null;

------------------------------------------------------------------------------------------------------
-- 2. Entrega do benefício (idempotente)
------------------------------------------------------------------------------------------------------
-- Devolve: plano_ativado | plano_ja_ativado | plano_nao_resolvido | credito_lancado | credito_ja_lancado
--          | nao_aprovado | nao_encontrada
create or replace function private.qf_aplicar_beneficio_recarga(p_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.qf_recargas;
  c public.qf_planos_catalogo;
  v_sobra integer;
  v_chamados integer;
  v_dias integer;
  v_bonus integer;
begin
  -- Trava a linha: dois processamentos ao mesmo tempo da mesma recarga andam um depois do outro.
  select * into r from public.qf_recargas where id = p_id for update;
  if r.id is null then return 'nao_encontrada'; end if;
  if r.status is distinct from 'aprovado' then return 'nao_aprovado'; end if;

  if r.plano is not null then
    -- Pagamento de PLANO: só ativa o plano. Nunca vira saldo.
    select * into c from public.qf_planos_catalogo where plano = r.plano;
    if c.plano is not null and r.valor_centavos = c.preco_centavos then
      v_chamados := c.chamados; v_dias := c.dias;
    else
      select h.chamados, h.dias into v_chamados, v_dias
        from public.qf_planos_catalogo_hist h
       where h.plano = r.plano and h.preco_centavos = r.valor_centavos and h.substituido_em >= r.criado_em
       order by h.substituido_em
       limit 1;
    end if;
    if v_chamados is null or v_dias is null then
      perform private.qf_log_pagamento(r.id, r.profissional_id, 'plano_nao_resolvido',
        jsonb_build_object('plano', r.plano, 'valor_centavos', r.valor_centavos));
      return 'plano_nao_resolvido';
    end if;
    if exists (select 1 from public.qf_planos_profissional where recarga_id = r.id) then
      perform private.qf_log_pagamento(r.id, r.profissional_id, 'plano_ja_ativado', jsonb_build_object('plano', r.plano));
      return 'plano_ja_ativado';
    end if;
    select coalesce(sum(chamados_restantes), 0) into v_sobra from public.qf_planos_profissional
     where profissional_id = r.profissional_id and valido_ate > now() and chamados_restantes > 0;
    update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
     where profissional_id = r.profissional_id and valido_ate > now() and chamados_restantes > 0;
    insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, recarga_id)
    values (r.profissional_id, r.plano, v_chamados, v_chamados + v_sobra, now() + make_interval(days => v_dias), r.id);
    perform private.qf_log_pagamento(r.id, r.profissional_id, 'plano_ativado',
      jsonb_build_object('plano', r.plano, 'chamados', v_chamados, 'dias', v_dias, 'chamados_herdados', v_sobra));
    return 'plano_ativado';
  end if;

  -- Recarga de CRÉDITOS.
  if exists (
    select 1 from public.qf_movimentacoes_carteira m
     where m.referencia_tipo = 'recarga' and m.referencia_id = r.id and m.tipo = 'credito'
  ) then
    perform private.qf_log_pagamento(r.id, r.profissional_id, 'credito_ja_lancado', '{}'::jsonb);
    return 'credito_ja_lancado';
  end if;
  insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (r.profissional_id, 0, 0, false)
  on conflict (profissional_id) do nothing;
  update public.qf_carteiras set saldo_centavos = saldo_centavos + r.valor_centavos, atualizado_em = now()
   where profissional_id = r.profissional_id;
  insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (r.profissional_id, 'credito', r.valor_centavos, 'recarga', r.id,
    'Recarga aprovada via ' || case r.metodo when 'pix' then 'Pix' when 'cartao' then 'Cartão' when 'boleto' then 'Boleto' else r.metodo end);

  v_bonus := public.qf_bonus_recarga_centavos(r.valor_centavos);
  if v_bonus > 0 and not exists (
    select 1 from public.qf_movimentacoes_carteira m
     where m.referencia_tipo = 'bonus_recarga' and m.referencia_id = r.id
  ) then
    update public.qf_carteiras set saldo_centavos = saldo_centavos + v_bonus, atualizado_em = now()
     where profissional_id = r.profissional_id;
    -- O gatilho qf_bonus_prazo_nova_concessao registra a validade de 30 dias.
    insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
    values (r.profissional_id, 'bonus', v_bonus, 'bonus_recarga', r.id, 'Bônus da recarga (vale por 30 dias)');
  end if;
  perform private.qf_log_pagamento(r.id, r.profissional_id, 'credito_lancado',
    jsonb_build_object('valor_centavos', r.valor_centavos, 'bonus_centavos', coalesce(v_bonus, 0)));
  return 'credito_lancado';
end;
$$;

-- Gatilho: ao aprovar, entrega o benefício. Se a entrega falhar, o pagamento continua aprovado (o provedor já
-- confirmou), o erro fica registrado e a reconciliação tenta de novo — sem creditar duas vezes.
create or replace function public.qf_recarga_pagamento_aplicado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    begin
      perform private.qf_aplicar_beneficio_recarga(new.id);
    exception when others then
      perform private.qf_log_pagamento(new.id, new.profissional_id, 'erro_beneficio',
        jsonb_build_object('erro', sqlerrm, 'sqlstate', sqlstate));
    end;
  end if;
  return null;
end;
$$;

------------------------------------------------------------------------------------------------------
-- 3. Reconciliação de pagamentos aprovados
------------------------------------------------------------------------------------------------------
-- Aprovado sem benefício entregue: crédito sem lançamento na carteira ou plano sem ativação.
create or replace view private.qf_recargas_aprovadas_sem_beneficio as
select r.id, r.profissional_id, r.valor_centavos, r.plano, r.metodo, r.aprovado_em
  from public.qf_recargas r
 where r.status = 'aprovado'
   and (
     -- Plano que já entrou como saldo (falha antiga) NÃO é completado sozinho: daria saldo e plano ao mesmo tempo.
     -- Esse caso aparece em qf_planos_creditados_como_saldo e é resolvido pelo administrador com comprovação.
     (r.plano is not null
        and not exists (select 1 from public.qf_planos_profissional p where p.recarga_id = r.id)
        and not exists (select 1 from public.qf_movimentacoes_carteira m
                         where m.referencia_tipo = 'recarga' and m.referencia_id = r.id and m.tipo = 'credito'))
     or
     (r.plano is null and not exists (
        select 1 from public.qf_movimentacoes_carteira m
         where m.referencia_tipo = 'recarga' and m.referencia_id = r.id and m.tipo = 'credito'))
   );

-- Pagamento de plano que (por falha antiga) também entrou como saldo. Só alerta: corrigir saldo exige comprovação.
create or replace view private.qf_planos_creditados_como_saldo as
select r.id, r.profissional_id, r.valor_centavos, r.plano, r.aprovado_em
  from public.qf_recargas r
 where r.status = 'aprovado' and r.plano is not null
   and exists (
     select 1 from public.qf_movimentacoes_carteira m
      where m.referencia_tipo = 'recarga' and m.referencia_id = r.id and m.tipo = 'credito');

create or replace function private.qf_reconciliar_recargas_job()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_res text;
  n_sem integer := 0;
  n_aplicados integer := 0;
  n_erros integer := 0;
begin
  for r in select id, profissional_id from private.qf_recargas_aprovadas_sem_beneficio order by aprovado_em nulls first limit 100 loop
    n_sem := n_sem + 1;
    begin
      v_res := private.qf_aplicar_beneficio_recarga(r.id);
      if v_res in ('plano_ativado', 'credito_lancado') then n_aplicados := n_aplicados + 1; end if;
      perform private.qf_log_pagamento(r.id, r.profissional_id, 'reconciliacao', jsonb_build_object('resultado', v_res));
    exception when others then
      n_erros := n_erros + 1;
      perform private.qf_log_pagamento(r.id, r.profissional_id, 'erro_reconciliacao',
        jsonb_build_object('erro', sqlerrm, 'sqlstate', sqlstate));
    end;
  end loop;
  return jsonb_build_object('sem_beneficio', n_sem, 'aplicados', n_aplicados, 'erros', n_erros);
end;
$$;

-- Administrador: p_aplicar = false só mostra o que falta; true entrega o benefício que falta (uma vez só).
create or replace function public.qf_admin_reconciliar_recargas(p_aplicar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_itens jsonb;
  v_res jsonb := '{}'::jsonb;
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'forbidden'; end if;
  if coalesce(p_aplicar, false) then v_res := private.qf_reconciliar_recargas_job(); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'profissional_id', x.profissional_id, 'valor_centavos', x.valor_centavos,
           'plano', x.plano, 'aprovado_em', x.aprovado_em) order by x.aprovado_em), '[]'::jsonb)
    into v_itens from private.qf_recargas_aprovadas_sem_beneficio x;
  return jsonb_build_object(
    'aplicado', coalesce(p_aplicar, false),
    'resultado', v_res,
    'ainda_sem_beneficio', v_itens,
    'plano_creditado_como_saldo', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', y.id, 'profissional_id', y.profissional_id, 'valor_centavos', y.valor_centavos, 'plano', y.plano)), '[]'::jsonb)
        from private.qf_planos_creditados_como_saldo y));
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('qf-reconciliar-recargas', '*/5 * * * *', 'select private.qf_reconciliar_recargas_job();');
  end if;
end $$;

------------------------------------------------------------------------------------------------------
-- 4. Contabilidade administrativa
------------------------------------------------------------------------------------------------------
-- Três coisas que nunca se misturam:
--   dinheiro recebido  = pagamentos APROVADOS no provedor (recargas de crédito + planos);
--   créditos consumidos = desbloqueios pagos com saldo (já era dinheiro recebido antes, na recarga);
--   uso de planos       = desbloqueios feitos com chamados de plano (não geram dinheiro novo).
create or replace function public.qf_admin_contabilidade(p_dias integer default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 3650));
  v_ini timestamptz;
  v_out jsonb;
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'forbidden'; end if;
  v_ini := (date_trunc('day', now() at time zone 'America/Sao_Paulo') - make_interval(days => v_dias - 1)) at time zone 'America/Sao_Paulo';

  select jsonb_build_object(
    'gerado_em', now(),
    'dias', v_dias,
    'desde', v_ini,

    -- Dinheiro que entrou (provedor confirmou). Período e total desde o início.
    'recebido', jsonb_build_object(
      'periodo', (select jsonb_build_object(
          'creditos_centavos', coalesce(sum(valor_centavos) filter (where plano is null), 0),
          'planos_centavos',   coalesce(sum(valor_centavos) filter (where plano is not null), 0),
          'creditos_qtd', count(*) filter (where plano is null),
          'planos_qtd',   count(*) filter (where plano is not null))
        from public.qf_recargas where status = 'aprovado' and coalesce(aprovado_em, atualizado_em, criado_em) >= v_ini),
      'total', (select jsonb_build_object(
          'creditos_centavos', coalesce(sum(valor_centavos) filter (where plano is null), 0),
          'planos_centavos',   coalesce(sum(valor_centavos) filter (where plano is not null), 0),
          'creditos_qtd', count(*) filter (where plano is null),
          'planos_qtd',   count(*) filter (where plano is not null))
        from public.qf_recargas where status = 'aprovado'),
      'por_dia', coalesce((select jsonb_agg(jsonb_build_object(
          'dia', d.dia, 'creditos_centavos', d.cr, 'planos_centavos', d.pl) order by d.dia desc)
        from (select (coalesce(aprovado_em, atualizado_em, criado_em) at time zone 'America/Sao_Paulo')::date dia,
                     sum(valor_centavos) filter (where plano is null) cr,
                     sum(valor_centavos) filter (where plano is not null) pl
                from public.qf_recargas
               where status = 'aprovado' and coalesce(aprovado_em, atualizado_em, criado_em) >= v_ini
               group by 1) d), '[]'::jsonb)
    ),

    -- Situação de todos os pagamentos, separados em crédito e plano.
    'situacao', coalesce((select jsonb_agg(jsonb_build_object(
          'tipo', case when plano is null then 'credito' else 'plano' end,
          'status', status, 'qtd', qtd, 'valor_centavos', total) order by plano nulls first, status)
        from (select plano, status, count(*) qtd, sum(valor_centavos) total from public.qf_recargas group by plano, status) s
        ), '[]'::jsonb),

    -- Planos vendidos x ativados.
    'planos', jsonb_build_object(
      'vendidos', (select count(*) from public.qf_recargas where status = 'aprovado' and plano is not null),
      'ativados', (select count(*) from public.qf_recargas r where r.status = 'aprovado' and r.plano is not null
                     and exists (select 1 from public.qf_planos_profissional p where p.recarga_id = r.id)),
      'por_plano', coalesce((select jsonb_agg(jsonb_build_object('plano', plano, 'qtd', qtd, 'valor_centavos', total) order by plano)
                               from (select plano, count(*) qtd, sum(valor_centavos) total
                                       from public.qf_recargas where status = 'aprovado' and plano is not null group by plano) t), '[]'::jsonb),
      'ativos_agora', (select count(*) from public.qf_planos_profissional where valido_ate > now() and chamados_restantes > 0),
      'chamados_restantes', (select coalesce(sum(chamados_restantes), 0) from public.qf_planos_profissional where valido_ate > now() and chamados_restantes > 0)
    ),

    -- Desbloqueios no período, separados pela origem do pagamento.
    'desbloqueios', (select jsonb_build_object(
        'saldo_qtd', count(*) filter (where origem = 'saldo' and valor_centavos > 0),
        'saldo_centavos', coalesce(sum(valor_centavos) filter (where origem = 'saldo' and valor_centavos > 0), 0),
        'sem_cobranca_qtd', count(*) filter (where origem = 'saldo' and coalesce(valor_centavos, 0) = 0),
        'plano_qtd', count(*) filter (where origem = 'plano'))
      from public.qf_desbloqueios where coalesce(ativo, true) and criado_em >= v_ini),

    -- Bônus e ajustes administrativos (nunca entram como dinheiro recebido).
    'bonus_ajustes', coalesce((select jsonb_agg(jsonb_build_object(
          'tipo', tipo, 'origem', coalesce(referencia_tipo, ''), 'qtd', qtd, 'valor_centavos', total) order by tipo, referencia_tipo)
        from (select tipo, referencia_tipo, count(*) qtd, sum(valor_centavos) total
                from public.qf_movimentacoes_carteira
               where criado_em >= v_ini
                 and (tipo in ('bonus', 'ajuste_admin') or (tipo in ('credito', 'debito') and referencia_tipo = 'admin'))
               group by tipo, referencia_tipo) b), '[]'::jsonb),

    -- O que pede ação do administrador.
    'alertas', jsonb_build_object(
      'aprovados_sem_beneficio', (select count(*) from private.qf_recargas_aprovadas_sem_beneficio),
      'plano_creditado_como_saldo', (select count(*) from private.qf_planos_creditados_como_saldo),
      'erros_recentes', (select count(*) from public.qf_pagamento_eventos
                          where evento in ('erro_beneficio', 'erro_reconciliacao', 'plano_nao_resolvido') and criado_em >= now() - interval '7 days'),
      'pendentes_antigos', (select count(*) from public.qf_recargas where status = 'pendente' and criado_em < now() - interval '2 days')
    )
  ) into v_out;
  return v_out;
end;
$$;

-- Últimos registros de processamento (para o administrador investigar).
create or replace function public.qf_admin_pagamento_eventos(p_limite integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not coalesce(private.qf_is_admin(), false) then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.criado_em desc)
                     from (select id, criado_em, tabela, referencia_id, profissional_id, evento, detalhe
                             from public.qf_pagamento_eventos order by criado_em desc
                            limit greatest(1, least(coalesce(p_limite, 50), 200))) e), '[]'::jsonb);
end;
$$;

revoke execute on function public.qf_admin_reconciliar_recargas(boolean) from public, anon;
revoke execute on function public.qf_admin_contabilidade(integer) from public, anon;
revoke execute on function public.qf_admin_pagamento_eventos(integer) from public, anon;
grant execute on function public.qf_admin_reconciliar_recargas(boolean) to authenticated;
grant execute on function public.qf_admin_contabilidade(integer) to authenticated;
grant execute on function public.qf_admin_pagamento_eventos(integer) to authenticated;

------------------------------------------------------------------------------------------------------
-- 5. Ajuste manual de saldo com trilha
------------------------------------------------------------------------------------------------------
-- Antes: valor negativo gravava tipo 'ajuste' (não existe) e valor negativo (proibido) — sempre falhava.
-- Agora: crédito = 'credito', desconto = 'debito' (valor positivo), sem deixar o saldo negativo, e com registro de quem fez.
create or replace function public.qf_admin_adicionar_creditos(p_user_id uuid, p_valor_centavos integer, p_descricao text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_antes bigint;
  v_depois bigint;
  v_desc text := coalesce(nullif(trim(p_descricao), ''), 'Ajuste do administrador');
begin
  if auth.uid() is null or not exists(select 1 from public.qf_admins where user_id = auth.uid()) then raise exception 'forbidden'; end if;
  if coalesce(p_valor_centavos, 0) = 0 then return jsonb_build_object('ok', false, 'reason', 'valor_invalido'); end if;

  insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (p_user_id, 0, 0, false)
  on conflict (profissional_id) do nothing;

  select saldo_centavos into v_antes from public.qf_carteiras where profissional_id = p_user_id for update;
  if v_antes + p_valor_centavos < 0 then
    return jsonb_build_object('ok', false, 'reason', 'saldo_insuficiente');
  end if;

  update public.qf_carteiras set saldo_centavos = saldo_centavos + p_valor_centavos, atualizado_em = now()
   where profissional_id = p_user_id returning saldo_centavos into v_depois;

  insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, descricao)
  values (p_user_id, case when p_valor_centavos > 0 then 'credito' else 'debito' end, abs(p_valor_centavos), 'admin', v_desc);

  perform private.qf_log_pagamento(null, p_user_id, 'ajuste_manual',
    jsonb_build_object('admin_id', auth.uid(), 'valor_centavos', p_valor_centavos, 'saldo_antes_centavos', v_antes,
                       'saldo_depois_centavos', v_depois, 'descricao', v_desc), 'qf_carteiras');
  return jsonb_build_object('ok', true);
end;
$$;
