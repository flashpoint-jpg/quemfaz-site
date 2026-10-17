-- Painel "Profissionais próximos ao pedido": pedido em Outros sem profissional no serviço lista quem tem
-- Outros / atividade escrita (os mesmos que recebem o aviso), conta os elegíveis certos e marca quem foi avisado.
create or replace function private.qf_pedido_outros_sem_profissional(p_chamado_id uuid)
returns boolean language sql stable security definer set search_path to '' as $$
  select (c.categoria = 'cat_outros' or c.categoria like 'cat\_custom\_%')
     and not exists (select 1 from public.qf_profissionais p
                     join public.qf_profiles pf on pf.id = p.user_id
                     where coalesce(pf.ativo, true) and p.user_id <> c.cliente_id and c.categoria = any(p.especialidades))
  from public.qf_chamados c where c.id = p_chamado_id;
$$;
revoke all on function private.qf_pedido_outros_sem_profissional(uuid) from public, anon, authenticated;

create or replace function private.qf_pro_de_outros(p_especialidades text[])
returns boolean language sql immutable set search_path to '' as $$
  select 'cat_outros' = any(coalesce(p_especialidades, array[]::text[]))
      or exists (select 1 from unnest(coalesce(p_especialidades, array[]::text[])) e where e like 'cat\_custom\_%');
$$;

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
                  and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades)
                       or (o.sem and private.qf_pro_de_outros(pr.especialidades)))),
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
            and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades)
                 or (o.sem and private.qf_pro_de_outros(pr.especialidades)))
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

-- "Reenviar aviso" do painel: pedido em Outros sem profissional no serviço reenvia para quem tem Outros /
-- atividade escrita (mesma regra do aviso automático). Os demais pedidos seguem como antes.
CREATE OR REPLACE FUNCTION public.qf_admin_lembrar_proximos(p_chamado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c record;
  v_ids uuid[];
  v_com integer;
  v_ultimo timestamptz;
  v_seg text;
  v_titulo text;
  v_corpo text;
  v_local text;
  v_outros boolean;
  v_rota text := '/profissional/servicos/disponiveis';
  i integer;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('qf_lembrete:' || p_chamado_id::text));

  select ch.id, ch.titulo, ch.bairro, ch.cidade, ch.uf, ch.status into c
    from public.qf_chamados ch where ch.id = p_chamado_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Pedido não encontrado.');
  end if;
  if c.status not in ('aberto', 'em_negociacao') then
    return jsonb_build_object('ok', false, 'reason', 'Este pedido já foi encerrado.');
  end if;
  if (select count(*) from public.qf_desbloqueios d where d.chamado_id = c.id and coalesce(d.ativo, true))
     >= public.qf_limite_orcamentos(c.id) then
    return jsonb_build_object('ok', false, 'reason', 'As vagas deste pedido já foram preenchidas.');
  end if;

  select v.ultimo into v_ultimo from (select max(l.enviado_em) as ultimo from public.qf_lembretes_pedido l where l.chamado_id = c.id) v;
  if v_ultimo is not null and v_ultimo > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason',
      'Este pedido já foi lembrado há pouco. Espere 10 minutos para não incomodar os profissionais.');
  end if;

  v_outros := coalesce(private.qf_pedido_outros_sem_profissional(c.id), false);
  if v_outros then
    select array_agg(d.user_id), count(*) filter (where d.com_aparelho)
      into v_ids, v_com from private.qf_outros_destinatarios(c.id) d;
    v_rota := '/profissional/outros-pedidos';
  else
    select array_agg(d.user_id), count(*) filter (where d.com_aparelho)
      into v_ids, v_com from private.qf_lembrete_destinatarios(c.id) d;
  end if;
  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'Ninguém online, perto e sem responder a este pedido agora.');
  end if;

  v_local := concat_ws(' · ', nullif(trim(coalesce(c.bairro, '')), ''),
                              nullif(concat_ws('/', nullif(trim(coalesce(c.cidade, '')), ''), nullif(trim(coalesce(c.uf::text, '')), '')), ''));
  if v_outros then
    v_titulo := left('📌 Pedido em Outros perto de você: ' || coalesce(nullif(trim(coalesce(c.titulo, '')), ''), 'serviço'), 120);
    v_corpo := left(coalesce(v_local || '. ', '') || 'Se você faz esse serviço, toque para ver.', 400);
  else
    v_titulo := left('📌 Pedido perto de você: ' || coalesce(nullif(trim(coalesce(c.titulo, '')), ''), 'serviço'), 120);
    v_corpo := left(coalesce(v_local || '. ', '') || 'Ainda tem vaga — toque para ver.', 400);
  end if;

  insert into public.qf_lembretes_pedido (chamado_id, enviado_por, user_ids, alvo, com_aparelho)
  values (c.id, auth.uid(), v_ids, cardinality(v_ids), coalesce(v_com, 0));

  delete from public.qf_profissional_avisos a
   where a.chamado_id = c.id and a.tipo = 'lembrete_pedido' and a.user_id = any(v_ids);
  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  select u, c.id, 'lembrete_pedido', v_titulo, v_corpo, v_rota from unnest(v_ids) u;

  select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;
  i := 1;
  while i <= cardinality(v_ids) loop
    perform net.http_post(
      url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
      body := jsonb_build_object('action', 'user_notice', 'user_ids', to_jsonb(v_ids[i:i + 49]),
                                 'title', v_titulo, 'body', v_corpo, 'url', '/#' || v_rota, 'tag', 'qf-lembrete-pedido'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-qf-internal', coalesce(v_seg, '')),
      timeout_milliseconds := 20000);
    i := i + 50;
  end loop;

  return jsonb_build_object('ok', true, 'alvo', cardinality(v_ids), 'com_aparelho', coalesce(v_com, 0),
                            'sem_aparelho', cardinality(v_ids) - coalesce(v_com, 0));
end;
$function$;
