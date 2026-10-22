-- Painel "Profissionais próximos ao pedido": só aparece quem é da profissão do pedido E está dentro do raio
-- que ele mesmo configurou (mesma regra de quem recebe o chamado). Fora do raio, sem localização e sem a
-- profissão não entram na lista nem na contagem. Pedido em Outros continua usando o grupo de Outros.
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
                       or (o.sem and private.qf_pro_de_outros(pr.especialidades)))
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
                 or (o.sem and private.qf_pro_de_outros(pr.especialidades)))
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
