-- QuemFaz 11.9.0 — chamado chega em quem está offline (cascata em 3 etapas)
-- Etapa 1: só online (o que já existia, gatilho qf_push_novo_chamado_after_insert).
-- Etapa 2: após X s sem aceite, push para todos os profissionais ativos da região/categoria (online ou offline).
-- Etapa 3: após Y min sem aceite, o chamado entra na lista "Chamados sem resposta" do admin (WhatsApp) e o admin é avisado.
-- X e Y ficam em qf_config.cascata_chamados (editáveis no painel admin, sem deploy).

-- 1) Configuração
insert into public.qf_config (chave, valor)
values ('cascata_chamados', '{"ativo": true, "etapa2_segundos": 60, "etapa3_minutos": 5}'::jsonb)
on conflict (chave) do nothing;

-- 2) Estado "ficou offline por vontade própria" (o online automático respeita)
alter table public.qf_profissionais
  add column if not exists offline_manual boolean not null default false;

-- 3) Em qual etapa cada aviso foi entregue
alter table public.qf_push_entregas
  add column if not exists cascata_etapa smallint;

-- 4) Estado da cascata por chamado (só o servidor escreve; admin lê por RPC)
create table if not exists public.qf_chamado_cascata (
  chamado_id uuid primary key references public.qf_chamados(id) on delete cascade,
  etapa smallint not null default 1 check (etapa between 1 and 3),
  etapa1_em timestamptz not null default now(),
  etapa2_em timestamptz,
  etapa3_em timestamptz,
  etapa2_destinatarios integer,
  etapa2_enviados integer,
  aceito_etapa smallint check (aceito_etapa between 1 and 3),
  aceito_em timestamptz,
  aceito_por uuid,
  aceito_online boolean,
  atualizado_em timestamptz not null default now()
);
alter table public.qf_chamado_cascata enable row level security;
revoke all on public.qf_chamado_cascata from anon, authenticated;
create index if not exists qf_chamado_cascata_pendentes_idx
  on public.qf_chamado_cascata (etapa) where aceito_em is null;

-- 5) Utilitários de região
create or replace function private.qf_norm_txt(p text)
returns text language sql immutable set search_path to '' as $$
  select translate(lower(trim(coalesce(p, ''))),
    'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
$$;

create or replace function private.qf_pro_atende_regiao(
  p_pro uuid, p_cidade text, p_uf text, p_lat numeric, p_lng numeric)
returns boolean language sql stable security definer set search_path to '' as $$
  select
    exists (
      select 1 from public.qf_profissional_cidades pc
      where pc.profissional_id = p_pro
        and (
          (private.qf_norm_txt(pc.cidade) = private.qf_norm_txt(p_cidade)
            and upper(trim(pc.uf::text)) = upper(trim(coalesce(p_uf, ''))))
          or (p_lat is not null and pc.latitude is not null
            and public.qf_distancia_km(pc.latitude, pc.longitude, p_lat, p_lng) <= greatest(1, coalesce(pc.raio_km, 10)))
        )
    )
    or exists (
      select 1 from public.qf_profissionais pr
      where pr.user_id = p_pro and p_lat is not null and pr.latitude is not null
        and public.qf_distancia_km(pr.latitude, pr.longitude, p_lat, p_lng) <=
            greatest(1, coalesce((select max(pc.raio_km) from public.qf_profissional_cidades pc where pc.profissional_id = p_pro), pr.raio_km, 20))
    );
$$;

-- 6) Destinatários da etapa 2: todo profissional ativo (não bloqueado) da categoria e da região, online ou não
create or replace function public.qf_cascata_destinatarios(p_chamado_id uuid)
returns table (user_id uuid, online boolean)
language sql stable security definer set search_path to '' as $$
  select pr.user_id, pr.online
  from public.qf_chamados c
  join public.qf_profissionais pr on true
  join public.qf_profiles pf on pf.id = pr.user_id
  where c.id = p_chamado_id
    and c.status = 'aberto'
    and coalesce(pf.ativo, true)
    and pr.user_id <> c.cliente_id
    and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))
    and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
    and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude);
$$;
revoke all on function public.qf_cascata_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.qf_cascata_destinatarios(uuid) to service_role;

-- 7) Reserva de aviso passa a gravar a etapa da cascata
create or replace function public.qf_push_reservar_entregas(p_chamado_id uuid, p_user_ids uuid[], p_evento text, p_raio_etapa_km integer)
returns uuid[] language plpgsql security definer set search_path to 'public' as $function$
declare
  v_ids uuid[];
  v_etapa smallint;
begin
  select k.etapa into v_etapa from public.qf_chamado_cascata k where k.chamado_id = p_chamado_id;
  with ins as (
    insert into public.qf_push_entregas(chamado_id,user_id,evento,raio_etapa_km,cascata_etapa)
    select p_chamado_id,u,p_evento,p_raio_etapa_km,coalesce(v_etapa,1)
    from unnest(coalesce(p_user_ids,array[]::uuid[])) as u
    on conflict(chamado_id,user_id,evento) do nothing
    returning user_id
  )
  select coalesce(array_agg(user_id),array[]::uuid[]) into v_ids from ins;
  return v_ids;
end;
$function$;

-- 8) Chamado novo começa na etapa 1
create or replace function private.qf_cascata_iniciar()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.status = 'aberto' then
    insert into public.qf_chamado_cascata (chamado_id) values (new.id) on conflict do nothing;
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz cascata iniciar: %', sqlerrm;
  return new;
end;
$$;
drop trigger if exists qf_cascata_iniciar_after_insert on public.qf_chamados;
create trigger qf_cascata_iniciar_after_insert after insert on public.qf_chamados
  for each row execute function private.qf_cascata_iniciar();

-- 9) Aceite (desbloqueio) para a cascata na hora e registra a etapa
create or replace function private.qf_cascata_aceite()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  update public.qf_chamado_cascata k
     set aceito_etapa = k.etapa,
         aceito_em = now(),
         aceito_por = new.profissional_id,
         aceito_online = (select pr.online from public.qf_profissionais pr where pr.user_id = new.profissional_id),
         atualizado_em = now()
   where k.chamado_id = new.chamado_id and k.aceito_em is null;
  return new;
exception when others then
  raise warning 'QuemFaz cascata aceite: %', sqlerrm;
  return new;
end;
$$;
drop trigger if exists qf_cascata_aceite_after_insert on public.qf_desbloqueios;
create trigger qf_cascata_aceite_after_insert after insert on public.qf_desbloqueios
  for each row execute function private.qf_cascata_aceite();

-- 10) Relógio da cascata (pg_cron a cada 10 s)
create or replace function private.qf_cascata_config()
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object(
    'ativo', coalesce((c.valor->>'ativo')::boolean, true),
    'etapa2_segundos', least(3600, greatest(10, coalesce((c.valor->>'etapa2_segundos')::int, 60))),
    'etapa3_minutos', least(720, greatest(1, coalesce((c.valor->>'etapa3_minutos')::int, 5))))
  from (select (select valor from public.qf_config where chave = 'cascata_chamados') as valor) c;
$$;

create or replace function private.qf_cascata_tick()
returns integer language plpgsql security definer set search_path to '' as $$
declare
  cfg jsonb := private.qf_cascata_config();
  v_x int := (cfg->>'etapa2_segundos')::int;
  v_y int := (cfg->>'etapa3_minutos')::int;
  r record;
  n int := 0;
begin
  if not (cfg->>'ativo')::boolean then return 0; end if;

  for r in
    with alvo as (
      select k.chamado_id from public.qf_chamado_cascata k
      join public.qf_chamados c on c.id = k.chamado_id
      where k.etapa = 1 and k.aceito_em is null
        and c.status = 'aberto'
        and c.criado_em <= now() - make_interval(secs => v_x)
        and c.criado_em >= now() - interval '1 day'
        and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id)
      for update of k skip locked
    )
    update public.qf_chamado_cascata k set etapa = 2, etapa2_em = now(), atualizado_em = now()
      from alvo where k.chamado_id = alvo.chamado_id
    returning k.chamado_id
  loop
    perform private.qf_push_interno('cascade_stage2', r.chamado_id);
    n := n + 1;
  end loop;

  for r in
    with alvo as (
      select k.chamado_id from public.qf_chamado_cascata k
      join public.qf_chamados c on c.id = k.chamado_id
      where k.etapa = 2 and k.aceito_em is null
        and c.status = 'aberto'
        and c.criado_em <= now() - make_interval(mins => v_y)
        and k.etapa2_em <= now() - interval '5 seconds'
        and c.criado_em >= now() - interval '1 day'
        and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id)
      for update of k skip locked
    )
    update public.qf_chamado_cascata k set etapa = 3, etapa3_em = now(), atualizado_em = now()
      from alvo where k.chamado_id = alvo.chamado_id
    returning k.chamado_id
  loop
    perform private.qf_push_interno('cascade_stage3', r.chamado_id);
    n := n + 1;
  end loop;

  return n;
end;
$$;

select cron.unschedule(jobid) from cron.job where jobname = 'qf-cascata-chamados';
select cron.schedule('qf-cascata-chamados', '10 seconds', 'select private.qf_cascata_tick();');

-- 11) Profissional offline enxerga (e pode aceitar) o chamado quando foi avisado ou quando a cascata chegou na etapa 2+
create or replace function public.qf_listar_chamados_disponiveis()
returns table(id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text, endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone, prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric, raio_atual_km integer)
language sql stable security definer set search_path to 'public' as $function$
  with profissional as (
    select
      pr.user_id,
      pr.especialidades,
      pr.online,
      pr.latitude as pro_latitude,
      pr.longitude as pro_longitude,
      greatest(
        1,
        coalesce(
          (select max(pc.raio_km)
             from public.qf_profissional_cidades pc
            where pc.profissional_id = pr.user_id),
          pr.raio_km,
          20
        )
      )::integer as raio_configurado_km
    from public.qf_profissionais pr
    where pr.user_id = auth.uid()
  )
  select
    c.id,
    c.categoria,
    c.titulo,
    c.descricao,
    c.cidade,
    c.uf,
    c.bairro,
    c.endereco_completo,
    c.latitude,
    c.longitude,
    c.data_preferida,
    c.prioridade,
    c.criado_em,
    c.status,
    case
      when public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude) is null then null
      else round(public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude), 1)
    end as distancia_km,
    p.raio_configurado_km as raio_atual_km
  from public.qf_chamados c
  cross join profissional p
  where c.status = 'aberto'
    and (
      p.online = true
      or exists (
        select 1 from public.qf_push_entregas e
        where e.chamado_id = c.id and e.user_id = p.user_id and e.evento = 'new_call'
      )
      or (
        exists (select 1 from public.qf_chamado_cascata k where k.chamado_id = c.id and k.etapa >= 2)
        and private.qf_pro_atende_regiao(p.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)
      )
    )
    and (
      cardinality(p.especialidades) = 0
      or c.categoria = any(p.especialidades)
    )
    and not exists (
      select 1
      from public.qf_desbloqueios d
      where d.chamado_id = c.id
        and d.profissional_id = p.user_id
    )
  order by c.prioridade desc,
           public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude) asc nulls last,
           c.criado_em desc;
$function$;

-- 12) Heartbeat / envio de posição: reafirma online=true (nunca desliga), respeitando o "ficar offline" manual
create or replace function public.qf_profissional_heartbeat(
  p_latitude numeric default null, p_longitude numeric default null, p_reafirmar boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid := auth.uid();
  v_loc boolean;
  v_online boolean;
  v_manual boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'sem_sessao');
  end if;
  v_loc := p_latitude is not null and p_longitude is not null
    and p_latitude between -90 and 90 and p_longitude between -180 and 180
    and not (p_latitude = 0 and p_longitude = 0);

  update public.qf_profissionais pr
     set latitude = case when v_loc then p_latitude else pr.latitude end,
         longitude = case when v_loc then p_longitude else pr.longitude end,
         localizacao_atualizada_em = case when v_loc then now() else pr.localizacao_atualizada_em end,
         atualizado_em = now()
   where pr.user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'sem_perfil_profissional');
  end if;

  if coalesce(p_reafirmar, true) then
    update public.qf_profissionais pr
       set online = true, atualizado_em = now()
     where pr.user_id = v_uid
       and pr.online = false
       and pr.offline_manual = false
       and exists (
         select 1 from public.qf_profiles pf
         where pf.id = v_uid and coalesce(pf.ativo, true)
           and nullif(trim(coalesce(pf.foto_url, '')), '') is not null
       );
  end if;

  select pr.online, pr.offline_manual into v_online, v_manual
    from public.qf_profissionais pr where pr.user_id = v_uid;
  return jsonb_build_object('ok', true, 'online', v_online, 'offline_manual', v_manual);
end;
$$;
revoke all on function public.qf_profissional_heartbeat(numeric, numeric, boolean) from public, anon;
grant execute on function public.qf_profissional_heartbeat(numeric, numeric, boolean) to authenticated;

-- 13) Admin: configuração da cascata
create or replace function public.qf_admin_cascata_config()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true) || private.qf_cascata_config();
end;
$$;

create or replace function public.qf_admin_salvar_cascata_config(
  p_etapa2_segundos integer, p_etapa3_minutos integer, p_ativo boolean default true)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if p_etapa2_segundos is null or p_etapa2_segundos < 10 or p_etapa2_segundos > 3600 then
    return jsonb_build_object('ok', false, 'reason', 'Etapa 2: use de 10 a 3600 segundos.');
  end if;
  if p_etapa3_minutos is null or p_etapa3_minutos < 1 or p_etapa3_minutos > 720 then
    return jsonb_build_object('ok', false, 'reason', 'Etapa 3: use de 1 a 720 minutos.');
  end if;
  if p_etapa3_minutos * 60 <= p_etapa2_segundos then
    return jsonb_build_object('ok', false, 'reason', 'A etapa 3 precisa vir depois da etapa 2.');
  end if;
  insert into public.qf_config (chave, valor, atualizado_em)
  values ('cascata_chamados', jsonb_build_object('ativo', coalesce(p_ativo, true),
          'etapa2_segundos', p_etapa2_segundos, 'etapa3_minutos', p_etapa3_minutos), now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('ok', true) || private.qf_cascata_config();
end;
$$;

-- 14) Admin: em qual etapa cada chamado foi aceito
create or replace function public.qf_admin_cascata_resumo(p_dias integer default 30)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_dias int := least(365, greatest(1, coalesce(p_dias, 30)));
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object(
    'ok', true,
    'dias', v_dias,
    'total', (select count(*) from public.qf_chamado_cascata k where k.etapa1_em >= now() - make_interval(days => v_dias)),
    'aceitos_etapa1', (select count(*) from public.qf_chamado_cascata k where k.aceito_etapa = 1 and k.etapa1_em >= now() - make_interval(days => v_dias)),
    'aceitos_etapa2', (select count(*) from public.qf_chamado_cascata k where k.aceito_etapa = 2 and k.etapa1_em >= now() - make_interval(days => v_dias)),
    'aceitos_etapa3', (select count(*) from public.qf_chamado_cascata k where k.aceito_etapa = 3 and k.etapa1_em >= now() - make_interval(days => v_dias)),
    'aceitos_por_offline', (select count(*) from public.qf_chamado_cascata k where k.aceito_online = false and k.etapa1_em >= now() - make_interval(days => v_dias)),
    'recentes', coalesce((
      select jsonb_agg(x order by x.criado_em desc) from (
        select c.id, c.titulo, c.categoria, c.cidade, c.uf, c.status, c.criado_em,
               k.etapa, k.etapa2_em, k.etapa3_em, k.etapa2_destinatarios, k.etapa2_enviados,
               k.aceito_etapa, k.aceito_em, k.aceito_online,
               (select count(*) from public.qf_push_entregas e where e.chamado_id = c.id and e.evento = 'new_call' and coalesce(e.cascata_etapa, 1) = 1) as avisados_etapa1,
               (select count(*) from public.qf_push_entregas e where e.chamado_id = c.id and e.evento = 'new_call' and e.cascata_etapa >= 2) as avisados_etapa2
        from public.qf_chamado_cascata k
        join public.qf_chamados c on c.id = k.chamado_id
        where k.etapa1_em >= now() - make_interval(days => v_dias)
        order by c.criado_em desc
        limit 40
      ) x), '[]'::jsonb)
  );
end;
$$;

-- 15) Admin: chamados sem resposta (etapa 3) + profissionais da região com WhatsApp
create or replace function public.qf_admin_chamados_sem_resposta()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object('ok', true, 'itens', coalesce((
    select jsonb_agg(x order by x.criado_em desc) from (
      select c.id, c.titulo, c.categoria, c.cidade, c.uf, c.bairro, c.criado_em, k.etapa3_em,
             round(extract(epoch from (now() - c.criado_em)) / 60.0)::int as minutos,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                        'user_id', pr.user_id,
                        'nome', pf.nome,
                        'whatsapp', coalesce(nullif(trim(pf.whatsapp), ''), nullif(trim(pf.telefone), '')),
                        'online', pr.online,
                        'avisado', exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id and e.evento = 'new_call'),
                        'tem_push', exists (select 1 from public.qf_push_subscriptions s where s.user_id = pr.user_id and s.ativo)
                      ) order by pr.online desc, pf.nome)
               from public.qf_profissionais pr
               join public.qf_profiles pf on pf.id = pr.user_id
               where coalesce(pf.ativo, true)
                 and pr.user_id <> c.cliente_id
                 and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))
                 and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
                 and private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)
             ), '[]'::jsonb) as profissionais
      from public.qf_chamado_cascata k
      join public.qf_chamados c on c.id = k.chamado_id
      where k.etapa = 3 and k.aceito_em is null
        and c.status = 'aberto'
        and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id)
        and c.criado_em >= now() - interval '3 days'
    ) x), '[]'::jsonb));
end;
$$;

revoke all on function public.qf_admin_cascata_config() from public, anon;
revoke all on function public.qf_admin_salvar_cascata_config(integer, integer, boolean) from public, anon;
revoke all on function public.qf_admin_cascata_resumo(integer) from public, anon;
revoke all on function public.qf_admin_chamados_sem_resposta() from public, anon;
grant execute on function public.qf_admin_cascata_config() to authenticated;
grant execute on function public.qf_admin_salvar_cascata_config(integer, integer, boolean) to authenticated;
grant execute on function public.qf_admin_cascata_resumo(integer) to authenticated;
grant execute on function public.qf_admin_chamados_sem_resposta() to authenticated;

revoke all on function private.qf_cascata_tick() from public, anon, authenticated;
revoke all on function private.qf_cascata_iniciar() from public, anon, authenticated;
revoke all on function private.qf_cascata_aceite() from public, anon, authenticated;

-- 16) A edge function (service_role) grava os contadores da etapa 2
grant select, update on public.qf_chamado_cascata to service_role;
