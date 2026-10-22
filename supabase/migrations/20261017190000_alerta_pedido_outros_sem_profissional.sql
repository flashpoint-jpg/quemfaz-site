-- Pedido sem profissional cadastrado e classificado como "Outros" (cat_outros ou serviço digitado, cat_custom_*):
-- avisa na hora, só quem tem "Outros" ou atividade escrita no cadastro, está online, dentro do horário e dentro do raio.
-- O pedido já aparece na aba "Outros pedidos" (qf_outros_pedidos_vitrine_v2); aqui só dispara o aviso.
-- Aviso leve (faixinha + aba Avisos), sem toque de chamado, no mesmo formato do "Reenviar aviso" do painel.

-- Quem recebe: profissional de "Outros" / atividade escrita, apto e perto do pedido.
create or replace function private.qf_outros_destinatarios(p_chamado_id uuid)
returns table(user_id uuid, com_aparelho boolean)
language sql stable security definer set search_path to '' as $$
  select pr.user_id,
         exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo) as com_aparelho
  from public.qf_chamados c
  join public.qf_profissionais pr
    on ('cat_outros' = any(coalesce(pr.especialidades, array[]::text[]))
        or exists (select 1 from unnest(coalesce(pr.especialidades, array[]::text[])) e where e like 'cat\_custom\_%'))
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

-- Dispara o aviso. Uma vez por pedido.
create or replace function private.qf_outros_alertar(p_chamado_id uuid)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  c record; v_ids uuid[]; v_seg text; v_titulo text; v_corpo text; v_local text; i integer;
  v_rota constant text := '/profissional/outros-pedidos';
begin
  select ch.id, ch.titulo, ch.bairro, ch.cidade, ch.uf into c from public.qf_chamados ch where ch.id = p_chamado_id;
  if not found then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('qf_outros_alerta:' || p_chamado_id::text));
  if exists (select 1 from public.qf_profissional_avisos a where a.chamado_id = c.id and a.tipo = 'pedido_outros') then
    return 0;
  end if;
  -- Só vale para pedido sem profissional: se alguém cadastrado nesse serviço atende, o fluxo normal já cuida.
  select array_agg(d.user_id) into v_ids from private.qf_outros_destinatarios(c.id) d;
  if v_ids is null or cardinality(v_ids) = 0 then return 0; end if;

  v_local := concat_ws(' · ', nullif(trim(coalesce(c.bairro, '')), ''),
                              nullif(concat_ws('/', nullif(trim(coalesce(c.cidade, '')), ''), nullif(trim(coalesce(c.uf::text, '')), '')), ''));
  v_titulo := left('📌 Pedido em Outros perto de você: ' || coalesce(nullif(trim(coalesce(c.titulo, '')), ''), 'serviço'), 120);
  v_corpo := left(coalesce(v_local || '. ', '') || 'Se você faz esse serviço, toque para ver.', 400);

  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  select u, c.id, 'pedido_outros', v_titulo, v_corpo, v_rota from unnest(v_ids) u;

  select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;
  i := 1;
  while i <= cardinality(v_ids) loop
    perform net.http_post(
      url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
      body := jsonb_build_object('action', 'user_notice', 'user_ids', to_jsonb(v_ids[i:i + 49]),
                                 'title', v_titulo, 'body', v_corpo, 'url', '/#' || v_rota, 'tag', 'qf-outros-pedido'),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-qf-internal', coalesce(v_seg, '')),
      timeout_milliseconds := 20000);
    i := i + 50;
  end loop;
  return cardinality(v_ids);
end;
$$;
revoke all on function private.qf_outros_alertar(uuid) from public, anon, authenticated;

-- Gatilho: pedido novo aberto, ou pedido que passa a aberto (ex.: urgente depois do Pix).
-- Roda depois dos gatilhos de antes (serviço oficial), então a categoria já está definitiva.
create or replace function private.qf_chamado_outros_alertar_trg()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.status = 'aberto' and (new.categoria = 'cat_outros' or new.categoria like 'cat\_custom\_%')
     and not exists (select 1 from public.qf_profissionais p
                     join public.qf_profiles pf on pf.id = p.user_id
                     where coalesce(pf.ativo, true) and p.user_id <> new.cliente_id and new.categoria = any(p.especialidades)) then
    perform private.qf_outros_alertar(new.id);
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz aviso pedido Outros: %', sqlerrm;
  return new;
end;
$$;
revoke all on function private.qf_chamado_outros_alertar_trg() from public, anon, authenticated;

drop trigger if exists qf_chamado_outros_alertar_after_insert on public.qf_chamados;
create trigger qf_chamado_outros_alertar_after_insert
  after insert on public.qf_chamados
  for each row execute function private.qf_chamado_outros_alertar_trg();

drop trigger if exists qf_chamado_outros_alertar_after_status on public.qf_chamados;
create trigger qf_chamado_outros_alertar_after_status
  after update of status on public.qf_chamados
  for each row when (old.status is distinct from new.status and new.status = 'aberto')
  execute function private.qf_chamado_outros_alertar_trg();
