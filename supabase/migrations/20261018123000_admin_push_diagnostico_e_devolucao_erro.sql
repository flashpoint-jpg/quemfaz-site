-- 2026-10-18 — Painel admin: (1) diagnóstico do push por pedido (somente leitura);
-- (2) devolução manual por erro, com baixa na receita do painel.
--
-- Aditiva: só cria funções, duas colunas novas em qf_devolucoes_lead e amplia a lista de motivos
-- permitidos dessa tabela (hoje vazia). Não altera pedidos, carteiras, pagamentos, preços nem o
-- disparo de push. A chave qf_config 'devolucao_lead' (devolução automática, hoje desligada)
-- NÃO é tocada: a devolução manual é uma decisão do administrador, feita caso a caso.
--
-- Como a baixa aparece na receita: o painel já desconta, na "Entrada", todo lançamento de carteira
-- do tipo 'estorno' ligado a um chamado (referencia_tipo = 'chamado'). A devolução manual grava
-- exatamente esse lançamento. (O "Ajuste do administrador" antigo é um 'credito' de origem 'admin'
-- e por isso não dava baixa.)

-- ---------------------------------------------------------------------------------------------
-- 0. Motivos permitidos + quem devolveu e o detalhe
-- ---------------------------------------------------------------------------------------------
alter table public.qf_devolucoes_lead drop constraint if exists qf_devolucoes_lead_motivo_check;
alter table public.qf_devolucoes_lead add constraint qf_devolucoes_lead_motivo_check
  check (motivo = any (array[
    'cliente_cancelou', 'chamado_expirou', 'cliente_nao_respondeu',
    'erro_cadastro_cliente', 'telefone_invalido', 'pedido_duplicado', 'outro_admin'
  ]));
alter table public.qf_devolucoes_lead add column if not exists detalhe text;
alter table public.qf_devolucoes_lead add column if not exists devolvido_por uuid;

-- ---------------------------------------------------------------------------------------------
-- 1. Buscar desbloqueios para devolver: por código do pedido, nome do cliente, WhatsApp ou profissional
--    Código do pedido = os 8 primeiros caracteres do id (o mesmo que o painel mostra nos relatórios).
-- ---------------------------------------------------------------------------------------------
create or replace function public.qf_admin_buscar_desbloqueios(p_busca text, p_limite integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_busca, ''));
  v_nq text := private.qf_norm_txt(v_q);
  v_digitos text := regexp_replace(v_q, '\D', '', 'g');
  v_hex text := lower(regexp_replace(v_q, '[^0-9a-fA-F-]', '', 'g'));
  v_hex_ok boolean := v_q ~ '^[0-9a-fA-F-]{6,36}$';
  v_lim integer := least(greatest(coalesce(p_limite, 20), 1), 50);
  v_itens jsonb;
begin
  if auth.uid() is null or not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'itens', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x.j order by x.criado_em desc), '[]'::jsonb) into v_itens
  from (
    select d.criado_em,
      jsonb_build_object(
        'desbloqueio_id', d.id,
        'chamado_id', c.id,
        'codigo', upper(left(c.id::text, 8)),
        'titulo', c.titulo,
        'cidade', c.cidade,
        'uf', c.uf,
        'cliente_nome', cli.nome,
        'cliente_whatsapp', coalesce(nullif(cli.whatsapp, ''), cli.telefone),
        'profissional_id', d.profissional_id,
        'profissional_nome', pro.nome,
        'valor_centavos', coalesce(d.valor_centavos, 0),
        'origem', d.origem,
        'criado_em', d.criado_em,
        'ativo', coalesce(d.ativo, true),
        'ja_devolvido', exists(select 1 from public.qf_devolucoes_lead dl where dl.desbloqueio_id = d.id),
        'devolvivel', (
          not exists(select 1 from public.qf_devolucoes_lead dl where dl.desbloqueio_id = d.id)
          and c.modalidade is distinct from 'valor_definido'
          and ((d.origem = 'saldo' and coalesce(d.valor_centavos, 0) > 0) or (d.origem = 'plano' and d.plano_id is not null))
        ),
        'motivo_bloqueio', case
          when exists(select 1 from public.qf_devolucoes_lead dl where dl.desbloqueio_id = d.id) then 'Já devolvido'
          when c.modalidade = 'valor_definido' then 'Pedido com valor definido: use a contestação'
          when d.origem = 'saldo' and coalesce(d.valor_centavos, 0) <= 0 then 'Desbloqueio sem cobrança'
          when d.origem not in ('saldo', 'plano') then 'Origem sem devolução automática'
          else null end
      ) as j
    from public.qf_desbloqueios d
    join public.qf_chamados c on c.id = d.chamado_id
    left join public.qf_profiles cli on cli.id = c.cliente_id
    left join public.qf_profiles pro on pro.id = d.profissional_id
    where (
      (v_hex_ok and lower(c.id::text) like v_hex || '%')
      or strpos(private.qf_norm_txt(cli.nome), v_nq) > 0
      or strpos(private.qf_norm_txt(pro.nome), v_nq) > 0
      or (length(v_digitos) >= 4
          and (regexp_replace(coalesce(cli.whatsapp, ''), '\D', '', 'g') like '%' || v_digitos || '%'
            or regexp_replace(coalesce(cli.telefone, ''), '\D', '', 'g') like '%' || v_digitos || '%'))
    )
    order by d.criado_em desc
    limit v_lim
  ) x;

  return jsonb_build_object('ok', true, 'itens', v_itens);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Devolver um desbloqueio por erro (só administrador)
--    Mesma mecânica da devolução automática (qf_private.devolver_lead), sem depender da chave
--    'devolucao_lead' e com motivo + detalhe + quem devolveu registrados.
--    - Pago com saldo: o valor volta para a carteira e grava um 'estorno' ligado ao chamado (dá a baixa na receita).
--    - Pago pelo plano: 1 chamado volta para o plano (não é dinheiro; não mexe na receita).
--    - A vaga do pedido volta a ficar livre (desbloqueio fica inativo).
--    - Pedido de "valor definido" fica de fora: o estorno dele é pela contestação.
-- ---------------------------------------------------------------------------------------------
create or replace function public.qf_admin_devolver_desbloqueio(
  p_desbloqueio_id uuid,
  p_motivo text,
  p_detalhe text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.qf_desbloqueios;
  v_id uuid;
  v_detalhe text := left(btrim(coalesce(p_detalhe, '')), 300);
  v_rotulo text;
  v_txt text;
  v_preco integer;
  v_nome text;
begin
  if auth.uid() is null or not private.qf_is_admin() then
    raise exception 'forbidden';
  end if;
  if p_motivo is null or p_motivo not in ('erro_cadastro_cliente', 'telefone_invalido', 'pedido_duplicado', 'outro_admin') then
    return jsonb_build_object('ok', false, 'reason', 'Escolha o motivo da devolução.');
  end if;
  if p_motivo = 'outro_admin' and length(v_detalhe) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'Explique o motivo da devolução.');
  end if;

  select * into d from public.qf_desbloqueios where id = p_desbloqueio_id for update;
  if d.id is null then
    return jsonb_build_object('ok', false, 'reason', 'Desbloqueio não encontrado.');
  end if;
  if exists(select 1 from public.qf_devolucoes_lead x where x.desbloqueio_id = d.id) then
    return jsonb_build_object('ok', false, 'reason', 'Este desbloqueio já foi devolvido.');
  end if;
  if exists(select 1 from public.qf_chamados ch where ch.id = d.chamado_id and ch.modalidade = 'valor_definido') then
    return jsonb_build_object('ok', false, 'reason', 'Pedido com valor definido: o estorno é pela contestação.');
  end if;

  v_rotulo := case p_motivo
    when 'erro_cadastro_cliente' then 'o cliente cadastrou o pedido errado'
    when 'telefone_invalido' then 'telefone do cliente inválido'
    when 'pedido_duplicado' then 'pedido duplicado'
    else 'outro motivo' end;
  v_txt := 'Devolução por erro: ' || v_rotulo || case when v_detalhe <> '' then ' — ' || v_detalhe else '' end;
  select nome into v_nome from public.qf_profiles where id = d.profissional_id;

  if d.origem = 'plano' then
    if d.plano_id is null then
      return jsonb_build_object('ok', false, 'reason', 'Desbloqueio sem cobrança.');
    end if;
    select coalesce(p.preco_centavos, padrao.preco_centavos, 790) into v_preco
      from public.qf_chamados c
      left join public.qf_precos_desbloqueio p on p.categoria = c.categoria and p.ativo
      left join public.qf_precos_desbloqueio padrao on padrao.categoria = 'padrao'
     where c.id = d.chamado_id;
    insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo, detalhe, devolvido_por)
    values (d.id, d.chamado_id, d.profissional_id, coalesce(v_preco, 790), p_motivo, nullif(v_detalhe, ''), auth.uid())
    on conflict (desbloqueio_id) do nothing returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'reason', 'Este desbloqueio já foi devolvido.');
    end if;
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
    return jsonb_build_object('ok', true, 'origem', 'plano', 'valor_centavos', 0, 'profissional_nome', v_nome, 'chamado_id', d.chamado_id);
  end if;

  if d.origem <> 'saldo' or coalesce(d.valor_centavos, 0) <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'Desbloqueio sem cobrança.');
  end if;
  -- Só devolve o que de fato foi cobrado da carteira.
  if not exists (select 1 from public.qf_movimentacoes_carteira m
                  where m.profissional_id = d.profissional_id and m.tipo = 'debito'
                    and m.referencia_tipo = 'chamado' and m.referencia_id = d.chamado_id) then
    return jsonb_build_object('ok', false, 'reason', 'Não há cobrança registrada na carteira para este desbloqueio.');
  end if;

  insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo, detalhe, devolvido_por)
  values (d.id, d.chamado_id, d.profissional_id, d.valor_centavos, p_motivo, nullif(v_detalhe, ''), auth.uid())
  on conflict (desbloqueio_id) do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'Este desbloqueio já foi devolvido.');
  end if;

  insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (d.profissional_id, 0, 0, true) on conflict (profissional_id) do nothing;
  update public.qf_carteiras set saldo_centavos = saldo_centavos + d.valor_centavos, atualizado_em = now()
   where profissional_id = d.profissional_id;
  insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (d.profissional_id, 'estorno', d.valor_centavos, 'chamado', d.chamado_id, v_txt);
  update public.qf_desbloqueios set ativo = false where id = d.id;
  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  values (d.profissional_id, d.chamado_id, 'lead_devolvido', 'Crédito devolvido',
          v_txt || '. R$ ' || replace(to_char(d.valor_centavos / 100.0, 'FM999990.00'), '.', ',') || ' voltaram para a sua carteira.',
          '/profissional/carteira')
  on conflict (user_id, chamado_id, tipo) do nothing;

  return jsonb_build_object('ok', true, 'origem', 'saldo', 'valor_centavos', d.valor_centavos, 'profissional_nome', v_nome, 'chamado_id', d.chamado_id);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 3. Lista das devoluções feitas (o que "aparece no financeiro") + totais
-- ---------------------------------------------------------------------------------------------
create or replace function public.qf_admin_devolucoes_lista(p_limite integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 30), 1), 100);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_itens jsonb;
  v_total bigint;
  v_total_hoje bigint;
begin
  if auth.uid() is null or not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  -- Só conta como dinheiro devolvido o que voltou para o saldo (devolução pelo plano devolve 1 chamado).
  select coalesce(sum(dl.valor_centavos), 0),
         coalesce(sum(dl.valor_centavos) filter (where (dl.criado_em at time zone 'America/Sao_Paulo')::date = v_hoje), 0)
    into v_total, v_total_hoje
    from public.qf_devolucoes_lead dl
    join public.qf_desbloqueios d on d.id = dl.desbloqueio_id
   where d.origem = 'saldo';

  select coalesce(jsonb_agg(x.j order by x.criado_em desc), '[]'::jsonb) into v_itens
  from (
    select dl.criado_em,
      jsonb_build_object(
        'id', dl.id,
        'criado_em', dl.criado_em,
        'valor_centavos', dl.valor_centavos,
        'origem', d.origem,
        'motivo', dl.motivo,
        'detalhe', dl.detalhe,
        'manual', dl.devolvido_por is not null,
        'codigo', upper(left(dl.chamado_id::text, 8)),
        'titulo', c.titulo,
        'cliente_nome', cli.nome,
        'profissional_nome', pro.nome
      ) as j
    from public.qf_devolucoes_lead dl
    join public.qf_desbloqueios d on d.id = dl.desbloqueio_id
    left join public.qf_chamados c on c.id = dl.chamado_id
    left join public.qf_profiles cli on cli.id = c.cliente_id
    left join public.qf_profiles pro on pro.id = dl.profissional_id
    order by dl.criado_em desc
    limit v_lim
  ) x;

  return jsonb_build_object('ok', true, 'total_centavos', v_total, 'hoje_centavos', v_total_hoje, 'itens', v_itens);
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Diagnóstico do push de um pedido: quem era elegível, quem recebeu, falhas e motivo de exclusão.
--    Somente leitura. Usa as mesmas regras do disparo (profissão, região/raio do profissional, online,
--    horário, pendência de finalização, vagas) — não envia nada.
--    "recebeu" = envio aceito pelo serviço de push; não comprova exibição no celular.
-- ---------------------------------------------------------------------------------------------
create or replace function public.qf_admin_push_diagnostico(p_chamado_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_c public.qf_chamados;
  v_limite integer;
  v_ocupadas integer;
  v_sem_vagas boolean;
  v_resumo jsonb;
  v_itens jsonb;
begin
  if auth.uid() is null or not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  select * into v_c from public.qf_chamados where id = p_chamado_id;
  if v_c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'pedido_nao_encontrado');
  end if;
  v_limite := public.qf_limite_orcamentos(p_chamado_id);
  select count(*) into v_ocupadas from public.qf_desbloqueios d
   where d.chamado_id = p_chamado_id and coalesce(d.ativo, true);
  v_sem_vagas := v_c.status not in ('aberto', 'em_negociacao')
    or v_ocupadas >= v_limite
    or exists(select 1 from public.qf_orcamentos o where o.chamado_id = p_chamado_id and o.status = 'aceito');

  with base as (
    select pr.user_id,
      coalesce(nullif(pf.nome, ''), 'Profissional') as nome,
      coalesce(pr.online, false) as online,
      coalesce(pf.ativo, true) as perfil_ativo,
      private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim) as no_horario,
      round(public.qf_distancia_km(pr.latitude, pr.longitude, v_c.latitude, v_c.longitude), 1) as km,
      exists(select 1 from public.qf_desbloqueios d where d.chamado_id = p_chamado_id and d.profissional_id = pr.user_id) as ja_desbloqueou,
      private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is not null as pendencia,
      private.qf_pro_recebe_chamado(pr.user_id, p_chamado_id) as na_regiao,
      (select count(*) from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo)::integer as tokens,
      e.envio_status as envio,
      e.envio_erro as erro,
      e.enviado_em
    from public.qf_profissionais pr
    join public.qf_profiles pf on pf.id = pr.user_id
    left join lateral (
      select x.envio_status, x.envio_erro, x.enviado_em
        from public.qf_push_entregas x
       where x.chamado_id = p_chamado_id and x.user_id = pr.user_id and x.evento = 'new_call'
       order by x.rodada desc nulls last, x.id desc
       limit 1
    ) e on true
    where v_c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
      and pr.user_id <> v_c.cliente_id
  ), cls as (
    select b.*,
      case
        when b.ja_desbloqueou then 'ja_desbloqueou'
        when not b.perfil_ativo then 'perfil_inativo'
        when not b.online then 'offline'
        when not b.no_horario then 'fora_do_horario'
        when b.pendencia then 'pendencia_finalizacao'
        when not coalesce(b.na_regiao, false) then 'fora_do_raio'
        when v_sem_vagas then 'sem_vagas'
        else 'elegivel' end as grupo
    from base b
  ), fin as (
    select c.*,
      case
        when c.ja_desbloqueou then 'ja_desbloqueou'
        when c.envio = 'enviado' then 'recebeu'
        when c.grupo <> 'elegivel' then c.grupo
        when c.envio = 'falhou' then 'falhou'
        when c.envio = 'legado' then 'sem_confirmacao'
        when c.tokens = 0 then 'sem_token'
        else 'pendente' end as situacao
    from cls c
  )
  select
    jsonb_build_object(
      'total_categoria', (select count(*) from fin),
      'elegiveis_agora', (select count(*) from fin where grupo = 'elegivel'),
      'por_situacao', (select coalesce(jsonb_object_agg(situacao, n), '{}'::jsonb)
                         from (select situacao, count(*) as n from fin group by situacao) t)
    ),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', f.user_id, 'nome', f.nome, 'km', f.km, 'situacao', f.situacao,
        'erro', f.erro, 'tokens', f.tokens, 'online', f.online, 'enviado_em', f.enviado_em
      ) order by (f.grupo = 'elegivel' or f.situacao = 'recebeu') desc, f.km asc nulls last, f.nome), '[]'::jsonb)
       from (select * from fin order by (grupo = 'elegivel' or situacao = 'recebeu') desc, km asc nulls last limit 400) f)
  into v_resumo, v_itens;

  return jsonb_build_object(
    'ok', true,
    'pedido', jsonb_build_object('id', v_c.id, 'titulo', v_c.titulo, 'cidade', v_c.cidade, 'uf', v_c.uf,
                                 'status', v_c.status, 'limite', v_limite, 'ocupadas', v_ocupadas),
    'resumo', v_resumo,
    'itens', v_itens
  );
end
$$;

revoke all on function public.qf_admin_buscar_desbloqueios(text, integer) from public, anon;
revoke all on function public.qf_admin_devolver_desbloqueio(uuid, text, text) from public, anon;
revoke all on function public.qf_admin_devolucoes_lista(integer) from public, anon;
revoke all on function public.qf_admin_push_diagnostico(uuid) from public, anon;
grant execute on function public.qf_admin_buscar_desbloqueios(text, integer) to authenticated;
grant execute on function public.qf_admin_devolver_desbloqueio(uuid, text, text) to authenticated;
grant execute on function public.qf_admin_devolucoes_lista(integer) to authenticated;
grant execute on function public.qf_admin_push_diagnostico(uuid) to authenticated;

-- Desfazer (só se necessário):
--   drop function if exists public.qf_admin_push_diagnostico(uuid);
--   drop function if exists public.qf_admin_devolucoes_lista(integer);
--   drop function if exists public.qf_admin_devolver_desbloqueio(uuid, text, text);
--   drop function if exists public.qf_admin_buscar_desbloqueios(text, integer);
--   (as colunas detalhe/devolvido_por e a lista ampliada de motivos podem ficar: são inofensivas)
