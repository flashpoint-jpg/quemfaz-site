-- V11.75: painel > "Próximos ao pedido" > botão "Lembrar quem está perto".
-- Manda um aviso comum (faixinha, sem o toque nem a tela cheia de chamado) para quem é do serviço,
-- está online dentro do horário, dentro do próprio raio e ainda não desbloqueou o pedido.
-- Quem não tem aparelho com notificação ativada recebe o aviso dentro do app (Avisos).
-- Não mexe na cascata, na carteira nem no pedido: só lembra.

create table if not exists public.qf_lembretes_pedido (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.qf_chamados(id) on delete cascade,
  enviado_por uuid not null,
  enviado_em timestamptz not null default now(),
  user_ids uuid[] not null default '{}',
  alvo integer not null default 0,
  com_aparelho integer not null default 0
);
create index if not exists qf_lembretes_pedido_chamado_idx on public.qf_lembretes_pedido (chamado_id, enviado_em desc);
alter table public.qf_lembretes_pedido enable row level security;
-- Sem política: só as funções abaixo (security definer) leem e gravam.
revoke all on public.qf_lembretes_pedido from public, anon, authenticated;
grant select, insert on public.qf_lembretes_pedido to service_role;

-- Quem recebe o lembrete de um pedido agora. Mesma conta de distância da tela "Próximos ao pedido":
-- localização do aparelho; se não tiver, a do endereço do cadastro.
create or replace function private.qf_lembrete_destinatarios(p_chamado_id uuid)
returns table(user_id uuid, com_aparelho boolean)
language sql
stable security definer
set search_path to ''
as $$
  select pr.user_id,
         exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo) as com_aparelho
  from public.qf_chamados c
  join public.qf_profissionais pr
    on (coalesce(cardinality(pr.especialidades), 0) = 0 or c.categoria = any(pr.especialidades))
  join public.qf_profiles pf on pf.id = pr.user_id
  left join lateral (
    select e.latitude, e.longitude from public.qf_enderecos e
    where e.user_id = pr.user_id and e.latitude is not null and e.longitude is not null
    order by e.atualizado_em desc nulls last limit 1
  ) en on true
  where c.id = p_chamado_id
    and c.status in ('aberto', 'em_negociacao')
    and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = c.id and o.status = 'aceito')
    and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id = c.id and coalesce(dx.ativo, true))
        < public.qf_limite_orcamentos(c.id)
    and coalesce(pf.ativo, true)
    and pr.user_id <> c.cliente_id
    -- Regra 11.41: offline não recebe; online só dentro do horário de atendimento.
    and pr.online is true
    and private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim)
    and private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null
    and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
    and public.qf_distancia_km(c.latitude, c.longitude,
          coalesce(pr.latitude, en.latitude), coalesce(pr.longitude, en.longitude))
        <= greatest(1, coalesce(pr.raio_km, 20));
$$;
revoke all on function private.qf_lembrete_destinatarios(uuid) from public, anon, authenticated;

create or replace function public.qf_admin_lembrar_proximos(p_chamado_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  c record;
  v_ids uuid[];
  v_com integer;
  v_ultimo timestamptz;
  v_seg text;
  v_titulo text;
  v_corpo text;
  v_local text;
  v_rota constant text := '/profissional/servicos/disponiveis';
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

  -- Trava de 10 minutos por pedido: não deixa o mesmo pedido incomodar o profissional em sequência.
  select max(l.enviado_em) into v_ultimo from public.qf_lembretes_pedido l where l.chamado_id = c.id;
  if v_ultimo is not null and v_ultimo > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'reason',
      'Este pedido já foi lembrado há pouco. Espere 10 minutos para não incomodar os profissionais.');
  end if;

  select array_agg(d.user_id), count(*) filter (where d.com_aparelho)
    into v_ids, v_com
    from private.qf_lembrete_destinatarios(c.id) d;
  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'Ninguém online, perto e sem responder a este pedido agora.');
  end if;

  v_local := concat_ws(' · ', nullif(trim(coalesce(c.bairro, '')), ''),
                              nullif(concat_ws('/', nullif(trim(coalesce(c.cidade, '')), ''), nullif(trim(coalesce(c.uf::text, '')), '')), ''));
  v_titulo := left('📌 Pedido perto de você: ' || coalesce(nullif(trim(coalesce(c.titulo, '')), ''), 'serviço'), 120);
  v_corpo := left(coalesce(v_local || '. ', '') || 'Ainda tem vaga — toque para ver.', 400);

  insert into public.qf_lembretes_pedido (chamado_id, enviado_por, user_ids, alvo, com_aparelho)
  values (c.id, auth.uid(), v_ids, cardinality(v_ids), coalesce(v_com, 0));

  -- Aviso dentro do app (aba Avisos): é o que alcança quem não tem aparelho com notificação ativada.
  delete from public.qf_profissional_avisos a
   where a.chamado_id = c.id and a.tipo = 'lembrete_pedido' and a.user_id = any(v_ids);
  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  select u, c.id, 'lembrete_pedido', v_titulo, v_corpo, v_rota from unnest(v_ids) u;

  -- Faixinha no celular: aviso comum da quemfaz-admin-aviso (sem toque de chamado), 50 por chamada.
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
$$;
revoke all on function public.qf_admin_lembrar_proximos(uuid) from public, anon;
grant execute on function public.qf_admin_lembrar_proximos(uuid) to authenticated;

-- Tela "Próximos ao pedido": quantos receberiam o lembrete agora, o último lembrete e quem já foi lembrado.
create or replace function private.qf_proximos_ao_pedido_dados(p_pedidos integer default 12, p_por_pedido integer default 15)
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
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
$$;
revoke all on function private.qf_proximos_ao_pedido_dados(integer, integer) from public, anon, authenticated;
