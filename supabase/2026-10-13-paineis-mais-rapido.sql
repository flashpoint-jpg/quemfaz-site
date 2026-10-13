-- V11.78: a tela "Painéis" do painel não carregava ("canceling statement due to statement timeout").
-- Com 20 pedidos abertos e 245 profissionais a consulta levava ~9 s e o limite do painel é 8 s.
-- Causa: o banco desdobrava o cálculo da situação do pedido para dentro da lista de profissionais
-- e o refazia uma vez por profissional. A correção força esse cálculo a acontecer uma vez por pedido.
-- O resultado da tela não muda.

create or replace function private.qf_paineis_dados()
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select coalesce(jsonb_agg(x.j order by x.criado_em asc), '[]'::jsonb)
  from (
    select c.criado_em, jsonb_build_object(
      'id', c.id, 'titulo', c.titulo, 'categoria', c.categoria, 'descricao', c.descricao,
      'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf, 'cep', c.cep,
      'latitude', c.latitude, 'longitude', c.longitude,
      'geo_precisao', coalesce(c.geo_precisao, case when c.latitude is null then 'sem' else 'cidade' end),
      'prazo', c.prazo, 'prazo_dia', c.prazo_dia, 'periodo', c.periodo,
      'status', c.status, 'criado_em', c.criado_em,
      'motivo', v.motivo,
      'limite', v.limite, 'ocupadas', v.ocupadas,
      'preco_centavos', coalesce(
        (select pd.preco_centavos from public.qf_precos_desbloqueio pd where pd.categoria = c.categoria and pd.ativo),
        (select pd.preco_centavos from public.qf_precos_desbloqueio pd where pd.categoria = 'padrao'), 790),
      'cliente', (select pf.nome from public.qf_profiles pf where pf.id = c.cliente_id),
      'cliente_telefone', (select coalesce(nullif(pf.whatsapp, ''), pf.telefone) from public.qf_profiles pf where pf.id = c.cliente_id),
      'cascata_etapa', (select k.etapa from public.qf_chamado_cascata k where k.chamado_id = c.id),
      'avisados', (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = c.id),
      'lembretes', (select count(*) from public.qf_lembretes_pedido l where l.chamado_id = c.id),
      'lembrete_em', (select max(l.enviado_em) from public.qf_lembretes_pedido l where l.chamado_id = c.id),
      'lembrete_alvo', (select l.alvo from public.qf_lembretes_pedido l where l.chamado_id = c.id order by l.enviado_em desc limit 1),
      'ultimo_desbloqueio_em', (select max(d.criado_em) from public.qf_desbloqueios d where d.chamado_id = c.id and coalesce(d.ativo, true)),
      'desbloqueios', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.profissional_id, 'nome', pf.nome,
                 'telefone', coalesce(nullif(pf.whatsapp, ''), pf.telefone),
                 'valor_centavos', d.valor_centavos, 'origem', d.origem, 'criado_em', d.criado_em, 'desfecho', d.desfecho,
                 'km', round(public.qf_distancia_km(c.latitude, c.longitude, pr.latitude, pr.longitude), 1)
               ) order by d.criado_em)
        from public.qf_desbloqueios d
        left join public.qf_profiles pf on pf.id = d.profissional_id
        left join public.qf_profissionais pr on pr.user_id = d.profissional_id
        where d.chamado_id = c.id and coalesce(d.ativo, true)), '[]'::jsonb),
      -- Quem está vendo este pedido na lista "Serviços disponíveis" agora.
      'no_painel', t.total, 'no_painel_online', t.online, 'com_local', t.com_local,
      'com_gps', t.com_gps, 'dentro_raio', t.dentro_raio, 'mais_perto_km', t.mais_perto_km, 'mais_perto_nome', t.mais_perto_nome
    ) as j
    from public.qf_chamados c
    cross join lateral (
      select private.qf_chamado_aberto_todos(c.id) as motivo,
             public.qf_limite_orcamentos(c.id) as limite,
             (select count(*) from public.qf_desbloqueios d where d.chamado_id = c.id and coalesce(d.ativo, true))::integer as ocupadas
      -- "offset 0" faz o banco calcular a situação do pedido UMA vez. Sem isso ele repetia
      -- qf_chamado_aberto_todos (que já passa por todos os profissionais) para cada profissional
      -- da lista abaixo, e a tela "Painéis" passava de 8 s e caía por tempo esgotado.
      offset 0
    ) v
    left join lateral (
      select count(*)::integer as total,
             (count(*) filter (where z.online))::integer as online,
             (count(*) filter (where z.km is not null))::integer as com_local,
             (count(*) filter (where z.km is not null and z.km <= z.raio_km))::integer as dentro_raio,
             -- "mais perto" só conta quem tem a localização do aparelho (a do endereço pode ser o centro da cidade).
             round(min(z.km) filter (where z.gps), 1) as mais_perto_km,
             (array_agg(z.nome order by z.km) filter (where z.gps and z.km is not null))[1] as mais_perto_nome,
             (count(*) filter (where z.gps))::integer as com_gps
      from (
        select pr.user_id, pf.nome, coalesce(pr.online, false) as online, coalesce(pr.raio_km, 20) as raio_km,
               (pr.latitude is not null and pr.longitude is not null) as gps,
               public.qf_distancia_km(c.latitude, c.longitude,
                 coalesce(pr.latitude, en.latitude), coalesce(pr.longitude, en.longitude)) as km
        from public.qf_profissionais pr
        join public.qf_profiles pf on pf.id = pr.user_id
        left join lateral (
          select e.latitude, e.longitude from public.qf_enderecos e
          where e.user_id = pr.user_id and e.latitude is not null and e.longitude is not null
          order by e.atualizado_em desc nulls last limit 1
        ) en on true
        where coalesce(pf.ativo, true)
          and pr.user_id is distinct from c.cliente_id
          and c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
          and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
          and (v.motivo is not null or private.qf_pro_recebe_chamado(pr.user_id, c.id))
      ) z
    ) t on true
    where c.status in ('aberto', 'em_negociacao')
      and v.ocupadas < v.limite
      and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = c.id and o.status = 'aceito')
  ) x;
$$;
revoke all on function private.qf_paineis_dados() from public, anon, authenticated;
