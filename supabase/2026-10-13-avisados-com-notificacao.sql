-- Painel: separar "avisado" de "avisado com notificação ativa".
-- A lista de quem recebe o aviso exige só "online", então muita gente sem
-- notificação ativa entrava como avisada sem receber nada no celular.
-- com_push guarda se a pessoa tinha alguma inscrição ativa na hora do aviso.

ALTER TABLE public.qf_push_entregas ADD COLUMN IF NOT EXISTS com_push boolean;

CREATE OR REPLACE FUNCTION private.qf_push_entregas_marcar_com_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.com_push is null then
    new.com_push := exists (
      select 1 from public.qf_push_subscriptions s
      where s.user_id = new.user_id and s.ativo
    );
  end if;
  return new;
end;
$function$;
REVOKE ALL ON FUNCTION private.qf_push_entregas_marcar_com_push() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS qf_push_entregas_com_push ON public.qf_push_entregas;
CREATE TRIGGER qf_push_entregas_com_push
  BEFORE INSERT ON public.qf_push_entregas
  FOR EACH ROW EXECUTE FUNCTION private.qf_push_entregas_marcar_com_push();

-- Avisos antigos: estimativa pela inscrição que existia na data do aviso
-- (criada antes e ainda ativa, ou desativada depois do aviso).
UPDATE public.qf_push_entregas e
SET com_push = exists (
  select 1 from public.qf_push_subscriptions s
  where s.user_id = e.user_id
    and s.criado_em <= e.criado_em
    and (s.ativo or s.atualizado_em > e.criado_em)
)
WHERE e.com_push IS NULL;

-- Chamados parados: total de avisados e quantos tinham notificação ativa.
CREATE OR REPLACE FUNCTION public.qf_admin_chamados_parados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(x order by x.minutos desc) from (
      select c.id, c.titulo, c.categoria, c.cidade, c.uf, c.bairro, c.criado_em,
        round(extract(epoch from (now() - c.criado_em)) / 60.0)::int as minutos,
        (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = c.id and e.evento = 'new_call') as avisados,
        (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = c.id and e.evento = 'new_call' and e.com_push) as avisados_com_push,
        p.nome as cliente_nome, p.telefone as cliente_telefone
      from public.qf_chamados c
      left join public.qf_profiles p on p.id = c.cliente_id
      where c.status = 'aberto'
        and c.criado_em <= now() - interval '10 minutes'
        and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id)
    ) x), '[]'::jsonb));
end;
$function$;

-- Painéis: mesmo critério de "avisados" de antes, mais avisados_com_push.
CREATE OR REPLACE FUNCTION private.qf_paineis_dados()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      'avisados_com_push', (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id = c.id and e.com_push),
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
$function$;

-- Próximos ao pedido: por profissional, se o aviso foi com notificação ativa.
CREATE OR REPLACE FUNCTION private.qf_proximos_ao_pedido_dados(p_pedidos integer DEFAULT 12, p_por_pedido integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(x.j order by x.criado_em desc), '[]'::jsonb)
  from (
    select c.criado_em, jsonb_build_object(
      'id', c.id, 'titulo', c.titulo, 'categoria', c.categoria, 'bairro', c.bairro, 'cidade', c.cidade, 'uf', c.uf,
      'status', c.status, 'criado_em', c.criado_em,
      'cliente', (select pf.nome from public.qf_profiles pf where pf.id = c.cliente_id),
      'total', (select count(*) from public.qf_profissionais pr join public.qf_profiles pf on pf.id = pr.user_id
                where coalesce(pf.ativo, true) and pr.user_id <> c.cliente_id
                  and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))),
      'com_vaga', (c.status in ('aberto', 'em_negociacao')
                   and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = c.id and o.status = 'aceito')
                   and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id = c.id and coalesce(dx.ativo, true))
                       < public.qf_limite_orcamentos(c.id)),
      'lembrar', (select count(*) from private.qf_lembrete_destinatarios(c.id)),
      'lembrar_com_aparelho', (select count(*) from private.qf_lembrete_destinatarios(c.id) d where d.com_aparelho),
      'lembrete', (select jsonb_build_object('em', l.enviado_em, 'alvo', l.alvo, 'com_aparelho', l.com_aparelho)
                     from public.qf_lembretes_pedido l where l.chamado_id = c.id order by l.enviado_em desc limit 1),
      'profissionais', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.km nulls last, t.nome)
        from (
          select pr.user_id as id, pf.nome, coalesce(nullif(pf.whatsapp, ''), pf.telefone) as telefone,
                 pf.cidade, pf.uf, pr.online, pr.verificado, pr.raio_km,
                 round(public.qf_distancia_km(c.latitude, c.longitude, g.lat, g.lon), 1) as km,
                 (pr.latitude is null and g.lat is not null) as pelo_endereco,
                 exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id and coalesce(d.ativo, true)) as desbloqueou,
                 exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id) as avisado,
                 exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id and e.com_push) as avisado_com_push,
                 exists (select 1 from public.qf_lembretes_pedido l where l.chamado_id = c.id and pr.user_id = any(l.user_ids)) as lembrado
          from public.qf_profissionais pr
          join public.qf_profiles pf on pf.id = pr.user_id
          left join lateral (
            select coalesce(pr.latitude, en.latitude) as lat, coalesce(pr.longitude, en.longitude) as lon
            from (select 1) um
            left join lateral (
              select e.latitude, e.longitude from public.qf_enderecos e
              where e.user_id = pr.user_id and e.latitude is not null and e.longitude is not null
              order by e.atualizado_em desc nulls last limit 1
            ) en on true
          ) g on true
          where coalesce(pf.ativo, true) and pr.user_id <> c.cliente_id
            and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))
          order by public.qf_distancia_km(c.latitude, c.longitude, g.lat, g.lon) nulls last, pf.nome
          limit least(50, greatest(1, coalesce(p_por_pedido, 15)))
        ) t), '[]'::jsonb)
    ) as j
    from public.qf_chamados c
    order by c.criado_em desc
    limit least(40, greatest(1, coalesce(p_pedidos, 12)))
  ) x;
$function$;
