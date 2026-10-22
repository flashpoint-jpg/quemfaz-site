-- V11.76: painel > "Painéis" — os pedidos que estão parados na tela dos profissionais (ainda com vaga),
-- com o relatório completo de cada um. E a correção da quilometragem: o pedido passa a guardar a
-- localização do BAIRRO (antes todo pedido ficava com a coordenada do centro da cidade, então o
-- profissional via a mesma distância em todos os pedidos da mesma cidade).

-- De onde veio a coordenada do pedido: 'gps', 'cep', 'bairro' ou 'cidade' (centro da cidade, aproximado).
alter table public.qf_chamados add column if not exists geo_precisao text;
comment on column public.qf_chamados.geo_precisao is 'Origem da coordenada do pedido: gps, cep, bairro ou cidade (centro da cidade, aproximada).';

-- Pedidos antigos: com CEP a coordenada veio do CEP; sem CEP veio do centro da cidade.
update public.qf_chamados
   set geo_precisao = case when coalesce(trim(cep), '') <> '' then 'cep' else 'cidade' end
 where geo_precisao is null and latitude is not null and longitude is not null;

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

create or replace function public.qf_admin_paineis()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'agora', now(), 'pedidos', private.qf_paineis_dados());
end;
$$;
revoke all on function public.qf_admin_paineis() from public, anon;
grant execute on function public.qf_admin_paineis() to authenticated;

-- O painel acha a coordenada do bairro e grava no pedido. Só troca coordenada aproximada (centro da
-- cidade) por uma do bairro, e só aceita um ponto a até 60 km de onde o pedido estava.
create or replace function public.qf_admin_corrigir_local_pedido(p_chamado_id uuid, p_lat numeric, p_lng numeric)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  c record;
  v_km numeric;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if p_lat is null or p_lng is null or p_lat < -34 or p_lat > 6 or p_lng < -74.5 or p_lng > -28 then
    return jsonb_build_object('ok', false, 'reason', 'Coordenada fora do Brasil.');
  end if;
  select ch.id, ch.latitude, ch.longitude, ch.geo_precisao into c from public.qf_chamados ch where ch.id = p_chamado_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Pedido não encontrado.');
  end if;
  if coalesce(c.geo_precisao, 'cidade') not in ('cidade', 'sem') then
    return jsonb_build_object('ok', false, 'reason', 'Este pedido já tem a localização do bairro.');
  end if;
  v_km := public.qf_distancia_km(c.latitude, c.longitude, p_lat, p_lng);
  if v_km is not null and v_km > 60 then
    return jsonb_build_object('ok', false, 'reason', 'Ponto longe demais da cidade do pedido.');
  end if;
  update public.qf_chamados set latitude = p_lat, longitude = p_lng, geo_precisao = 'bairro' where id = c.id;
  return jsonb_build_object('ok', true, 'moveu_km', round(coalesce(v_km, 0), 1));
end;
$$;
revoke all on function public.qf_admin_corrigir_local_pedido(uuid, numeric, numeric) from public, anon;
grant execute on function public.qf_admin_corrigir_local_pedido(uuid, numeric, numeric) to authenticated;
