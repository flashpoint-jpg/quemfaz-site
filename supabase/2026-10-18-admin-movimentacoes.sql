-- Painel admin: página "Movimentações" (tudo que entra, quem desbloqueou, planos).
-- Função só de leitura. Não altera nenhuma tabela e nada existente chama por ela ainda.
-- Para desfazer: drop function public.qf_admin_movimentacoes(integer);
--
-- Regras de contagem (as mesmas do restante do painel):
--  * "Entrou" = desbloqueios + planos vendidos + pedidos urgentes + anúncios, todos aprovados.
--    Desbloqueio conta qualquer valor cobrado (dinheiro real ou bônus). Desbloqueio feito pelo plano vale 0.
--    Desbloqueio devolvido (ativo = false) não conta.
--  * Recarga de carteira (crédito) aparece no extrato e no resumo, mas NÃO soma em "Entrou",
--    porque ela vira desbloqueio depois (contaria duas vezes).
--  * Dia vai de 00:00 a 23:59 no horário de São Paulo. p_dias = 1 é "hoje".

create or replace function public.qf_admin_movimentacoes(p_dias integer default 1)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_dias integer := greatest(1, least(coalesce(p_dias, 1), 365));
  v_ini timestamptz;
  v_out jsonb;
begin
  if not coalesce(private.qf_is_admin(), false) then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  v_ini := (date_trunc('day', now() at time zone 'America/Sao_Paulo') - make_interval(days => v_dias - 1)) at time zone 'America/Sao_Paulo';

  with
  desb as (
    select d.profissional_id,d.chamado_id,
           d.criado_em as em,
           case when d.origem = 'plano' then 0 else coalesce(d.valor_centavos, 0) end as centavos,
           d.origem,
           coalesce(d.exclusivo, false) as exclusivo,
           c.titulo, c.cidade
      from public.qf_desbloqueios d
      left join public.qf_chamados c on c.id = d.chamado_id
     where coalesce(d.ativo, true) and d.criado_em >= v_ini
  ),
  mov as (
    select '/admin/servicos/'||x.chamado_id as rota,x.em,
           case when x.exclusivo then 'desbloqueio_exclusivo' else 'desbloqueio' end as tipo,
           coalesce(p.nome, 'Profissional') as quem,
           concat_ws(' · ', nullif(x.titulo, ''), nullif(x.cidade, ''), case when x.origem = 'plano' then 'pelo plano' end) as detalhe,
           x.centavos,
           null::text as plano
      from desb x
      left join public.qf_profiles p on p.id = x.profissional_id
    union all
    select '/admin/profissionais/'||r.profissional_id,coalesce(r.aprovado_em, r.atualizado_em, r.criado_em), 'plano',
           coalesce(p.nome, 'Profissional'),
           concat_ws(' · ', 'Plano ' || coalesce(cat.nome, r.plano), case when cat.chamados is not null then cat.chamados || ' chamados' end),
           r.valor_centavos,
           r.plano
      from public.qf_recargas r
      left join public.qf_profiles p on p.id = r.profissional_id
      left join public.qf_planos_catalogo cat on cat.plano = r.plano
     where r.status = 'aprovado' and r.plano is not null
       and coalesce(r.aprovado_em, r.atualizado_em, r.criado_em) >= v_ini
    union all
    select '/admin/planos',coalesce(g.aprovado_em, g.criado_em), 'plano',
           coalesce(g.nome, 'Novo profissional'),
           concat_ws(' · ', 'Plano ' || coalesce(cat.nome, g.plano), 'pago, conta ainda não criada'),
           g.valor_centavos,
           g.plano
      from public.qf_pre_cadastro_pagamentos g
      left join public.qf_planos_catalogo cat on cat.plano = g.plano
     where g.status = 'aprovado' and g.recarga_id is null and g.profissional_id is null
       and g.email not ilike '%@exemplo.com'
       and coalesce(g.aprovado_em, g.criado_em) >= v_ini
    union all
    select '/admin/servicos/'||u.chamado_id,coalesce(u.aprovado_em, u.atualizado_em, u.criado_em), 'pedido_urgente',
           coalesce(cl.nome, 'Cliente'),
           concat_ws(' · ', nullif(c.titulo, ''), nullif(c.cidade, '')),
           u.valor_centavos,
           null::text
      from public.qf_prioridade_pagamentos u
      left join public.qf_chamados c on c.id = u.chamado_id
      left join public.qf_profiles cl on cl.id = u.cliente_id
     where u.status = 'aprovado'
       and coalesce(u.aprovado_em, u.atualizado_em, u.criado_em) >= v_ini
    union all
    select '/admin/anuncios',coalesce(ap.aprovado_em, ap.criado_em), 'anuncio',
           coalesce(a.anunciante_nome, 'Anunciante'),
           'QuemFaz Premium · ' || coalesce(nullif(a.titulo, ''), 'anúncio'),
           ap.valor_centavos,
           null::text
      from public.qf_anuncio_pagamentos ap
      left join public.qf_anuncios a on a.id = ap.anuncio_id
     where ap.status = 'aprovado'
       and coalesce(ap.aprovado_em, ap.criado_em) >= v_ini
    union all
    select '/admin/profissionais/'||r.profissional_id,coalesce(r.aprovado_em, r.atualizado_em, r.criado_em), 'recarga',
           coalesce(p.nome, 'Profissional'),
           concat_ws(' · ', 'Carteira', r.metodo),
           r.valor_centavos,
           null::text
      from public.qf_recargas r
      left join public.qf_profiles p on p.id = r.profissional_id
     where r.status = 'aprovado' and r.plano is null
       and coalesce(r.aprovado_em, r.atualizado_em, r.criado_em) >= v_ini
  )
  select jsonb_build_object(
    'ok', true,
    'gerado_em', now(),
    'dias', v_dias,
    'desde', v_ini,
    'resumo', jsonb_build_object(
      'desbloqueios_qtd',      (select count(*) from mov where tipo in ('desbloqueio', 'desbloqueio_exclusivo')),
      'desbloqueios_centavos', (select coalesce(sum(centavos), 0) from mov where tipo in ('desbloqueio', 'desbloqueio_exclusivo')),
      'planos_qtd',            (select count(*) from mov where tipo = 'plano'),
      'planos_centavos',       (select coalesce(sum(centavos), 0) from mov where tipo = 'plano'),
      'urgentes_qtd',          (select count(*) from mov where tipo = 'pedido_urgente'),
      'urgentes_centavos',     (select coalesce(sum(centavos), 0) from mov where tipo = 'pedido_urgente'),
      'anuncios_qtd',          (select count(*) from mov where tipo = 'anuncio'),
      'anuncios_centavos',     (select coalesce(sum(centavos), 0) from mov where tipo = 'anuncio'),
      'recargas_qtd',          (select count(*) from mov where tipo = 'recarga'),
      'recargas_centavos',     (select coalesce(sum(centavos), 0) from mov where tipo = 'recarga')
    ),
    'planos', coalesce((
      select jsonb_agg(jsonb_build_object(
          'plano', c.plano, 'nome', c.nome, 'preco_centavos', c.preco_centavos, 'chamados', c.chamados,
          'ativos', (select count(*) from public.qf_planos_profissional pp
                      where pp.plano = c.plano and pp.valido_ate > now() and pp.chamados_restantes > 0),
          'vendidos_qtd', (select count(*) from mov m where m.tipo = 'plano' and m.plano = c.plano),
          'vendidos_centavos', (select coalesce(sum(m.centavos), 0) from mov m where m.tipo = 'plano' and m.plano = c.plano)
        ) order by c.preco_centavos)
        from public.qf_planos_catalogo c where coalesce(c.ativo, true)), '[]'::jsonb),
    'avulso_profissionais', (select count(*) from public.qf_profissionais pr
                              where not exists (select 1 from public.qf_planos_profissional pp
                                                 where pp.profissional_id = pr.user_id and pp.valido_ate > now() and pp.chamados_restantes > 0)),
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object('profissional_id', t.profissional_id, 'nome', t.nome, 'qtd', t.qtd, 'centavos', t.centavos, 'ultimo_em', t.ultimo_em)
                       order by t.centavos desc, t.qtd desc, t.ultimo_em desc)
        from (select x.profissional_id, coalesce(p.nome, 'Profissional') as nome, count(*) as qtd,
                     coalesce(sum(x.centavos), 0) as centavos, max(x.em) as ultimo_em
                from desb x left join public.qf_profiles p on p.id = x.profissional_id
               group by x.profissional_id, p.nome
               order by coalesce(sum(x.centavos), 0) desc, count(*) desc, max(x.em) desc
               limit 10) t), '[]'::jsonb),
    'movimentos', coalesce((
      select jsonb_agg(jsonb_build_object('rota',m.rota,'em', m.em, 'tipo', m.tipo, 'quem', m.quem, 'detalhe', m.detalhe, 'centavos', m.centavos)
                       order by m.em desc)
        from (select * from mov order by em desc limit 40) m), '[]'::jsonb),
    'movimentos_total', (select count(*) from mov)
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.qf_admin_movimentacoes(integer) from public, anon;
grant execute on function public.qf_admin_movimentacoes(integer) to authenticated;

