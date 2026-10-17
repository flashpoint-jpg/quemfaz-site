-- Pedido em "Outros": (1) só entra quem tem a ver com o serviço do pedido; (2) o painel mostra quem está
-- online mas FORA do horário de atendimento (esse não recebe aviso, e antes aparecia só como "Online").
--
-- Regra de quem é "de Outros" para um pedido:
--   * quem marcou "Outros" (cat_outros) continua valendo para qualquer pedido em Outros;
--   * quem tem atividade escrita (cat_custom_*) só vale se alguma palavra do que escreveu bate com o serviço do
--     pedido (categoria digitada ou título). Antes, qualquer atividade escrita entrava em qualquer pedido.

create or replace function private.qf_tokens_servico(p_texto text)
returns text[] language sql immutable set search_path to '' as $$
  select coalesce(array_agg(distinct left(t, 5)), array[]::text[])
  from regexp_split_to_table(
         translate(lower(coalesce(p_texto, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
         '[^a-z0-9]+') t
  where length(t) >= 4
    and t not in ('para', 'geral', 'servico', 'servicos', 'sobre', 'como', 'tipo', 'mais', 'residencial', 'comercial');
$$;
revoke all on function private.qf_tokens_servico(text) from public, anon, authenticated;

create or replace function private.qf_pro_de_outros_do_pedido(p_especialidades text[], p_categoria text, p_titulo text)
returns boolean language sql immutable set search_path to '' as $$
  select 'cat_outros' = any(coalesce(p_especialidades, array[]::text[]))
      or exists (
        select 1 from unnest(coalesce(p_especialidades, array[]::text[])) e
        where e like 'cat\_custom\_%'
          and private.qf_tokens_servico(regexp_replace(regexp_replace(e, '^cat_custom_', ''), '_[a-z0-9]{5,8}$', ''))
              && private.qf_tokens_servico(regexp_replace(regexp_replace(coalesce(p_categoria, ''), '^cat_custom_', ''), '_[a-z0-9]{5,8}$', '')
                                           || ' ' || coalesce(p_titulo, ''))
      );
$$;
revoke all on function private.qf_pro_de_outros_do_pedido(text[], text, text) from public, anon, authenticated;

-- Destinatários do aviso de Outros (aviso automático e "Reenviar aviso"): mesma regra acima.
create or replace function private.qf_outros_destinatarios(p_chamado_id uuid)
returns table(user_id uuid, com_aparelho boolean)
language sql stable security definer set search_path to '' as $$
  select pr.user_id,
         exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo) as com_aparelho
  from public.qf_chamados c
  join public.qf_profissionais pr
    on private.qf_pro_de_outros_do_pedido(pr.especialidades, c.categoria, c.titulo)
  join public.qf_profiles pf on pf.id = pr.user_id
  where c.id = p_chamado_id
    and c.status = 'aberto'
    and (c.categoria = 'cat_outros' or c.categoria like 'cat\_custom\_%')
    and not exists (select 1 from public.qf_chamado_cascata k where k.chamado_id = c.id and k.oculto_admin)
    and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = c.id and o.status = 'aceito')
    and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id = c.id and coalesce(dx.ativo, true))
        < public.qf_limite_orcamentos(c.id)
    and coalesce(pf.ativo, true)
    and pr.user_id <> c.cliente_id
    -- Mesma regra do aviso de chamado: offline não recebe; online só dentro do horário de atendimento.
    and pr.online is true
    and private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim)
    and private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null
    and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
    -- Perto: dentro do raio que o próprio profissional configurou (sem coordenadas, não há aviso).
    and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude);
$$;
revoke all on function private.qf_outros_destinatarios(uuid) from public, anon, authenticated;

-- Painel "Profissionais próximos ao pedido": mesma regra, e cada profissional ganha no_horario.
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
      'outros', o.sem,
      'cliente', (select pf.nome from public.qf_profiles pf where pf.id = c.cliente_id),
      'total', (select count(*) from public.qf_profissionais pr join public.qf_profiles pf on pf.id = pr.user_id
                where coalesce(pf.ativo, true) and pr.user_id <> c.cliente_id
                  and (c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
                       or (o.sem and private.qf_pro_de_outros_do_pedido(pr.especialidades, c.categoria, c.titulo)))
                  and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)),
      'com_vaga', (c.status in ('aberto', 'em_negociacao')
                   and not exists (select 1 from public.qf_orcamentos o2 where o2.chamado_id = c.id and o2.status = 'aceito')
                   and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id = c.id and coalesce(dx.ativo, true))
                       < public.qf_limite_orcamentos(c.id)),
      'lembrar', case when o.sem then (select count(*) from private.qf_outros_destinatarios(c.id))
                      else (select count(*) from private.qf_lembrete_destinatarios(c.id)) end,
      'lembrar_com_aparelho', case when o.sem then (select count(*) from private.qf_outros_destinatarios(c.id) d where d.com_aparelho)
                                   else (select count(*) from private.qf_lembrete_destinatarios(c.id) d where d.com_aparelho) end,
      'lembrete', (select jsonb_build_object('em', l.enviado_em, 'alvo', l.alvo, 'com_aparelho', l.com_aparelho)
                     from public.qf_lembretes_pedido l where l.chamado_id = c.id order by l.enviado_em desc limit 1),
      'profissionais', coalesce((
        select jsonb_agg(to_jsonb(t) order by t.km nulls last, t.nome)
        from (
          select pr.user_id as id, pf.nome, coalesce(nullif(pf.whatsapp, ''), pf.telefone) as telefone,
                 pf.cidade, pf.uf, pr.online, pr.verificado, pr.raio_km,
                 private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim) as no_horario,
                 round(public.qf_distancia_km(c.latitude, c.longitude, g.lat, g.lon), 1) as km,
                 (pr.latitude is null and g.lat is not null) as pelo_endereco,
                 exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id and coalesce(d.ativo, true)) as desbloqueou,
                 (exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id)
                  or exists (select 1 from public.qf_profissional_avisos a where a.chamado_id = c.id and a.user_id = pr.user_id and a.tipo = 'pedido_outros')) as avisado,
                 (exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id and e.com_push)
                  or (exists (select 1 from public.qf_profissional_avisos a where a.chamado_id = c.id and a.user_id = pr.user_id and a.tipo = 'pedido_outros')
                      and exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo))) as avisado_com_push,
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
            and (c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
                 or (o.sem and private.qf_pro_de_outros_do_pedido(pr.especialidades, c.categoria, c.titulo)))
            and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)
          order by public.qf_distancia_km(c.latitude, c.longitude, g.lat, g.lon) nulls last, pf.nome
          limit least(50, greatest(1, coalesce(p_por_pedido, 15)))
        ) t), '[]'::jsonb)
    ) as j
    from public.qf_chamados c
    cross join lateral (select coalesce(private.qf_pedido_outros_sem_profissional(c.id), false) as sem) o
    order by c.criado_em desc
    limit least(40, greatest(1, coalesce(p_pedidos, 12)))
  ) x;
$function$;
