-- Radar de Leads Externos — estrutura completa (aditiva).
-- Continua as tabelas qf_leads_externos e qf_lead_events criadas no piloto (PR #78).
-- NÃO altera preços, créditos, bônus, pagamentos, carteiras nem triggers de qf_chamados.
-- Leads externos ficam em staging: nenhuma função daqui cria chamado, notificação ou cobrança.
--
-- Acesso: RLS ligada e fechada para anon/authenticated. Leitura e escrita só por funções:
--   * funções do painel   -> exigem private.qf_is_admin()
--   * ingestão e fontes   -> só service_role (executor agendado no servidor)
--
-- Vínculo com o pedido: o link do convite leva utm_source=radar e utm_content=<token>.
-- O formulário já grava esses valores em qf_chamados.marketing_origem; private.qf_radar_sync_pedidos()
-- apenas LÊ essa coluna para ligar o lead ao pedido que o próprio cliente publicou.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- colunas
alter table public.qf_leads_externos
  add column if not exists source_item_id text,
  add column if not exists service_slug text,
  add column if not exists neighborhood text,
  add column if not exists intent text not null default 'procura_profissional',
  add column if not exists urgency text,
  add column if not exists confidence numeric(3,2),
  add column if not exists content_hash text,
  add column if not exists duplicate_of uuid references public.qf_leads_externos(id) on delete set null,
  add column if not exists lawful_basis text not null default 'legitimo_interesse',
  add column if not exists is_test boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz not null default (now() + interval '30 days'),
  add column if not exists invite_token text,
  add column if not exists invite_channel text,
  add column if not exists invite_prepared_at timestamptz,
  add column if not exists invited_at timestamptz,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_chamado_id uuid references public.qf_chamados(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.qf_lead_events
  add column if not exists actor text not null default 'sistema',
  add column if not exists note text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'qf_leads_externos_status_chk') then
    alter table public.qf_leads_externos add constraint qf_leads_externos_status_chk
      check (status in ('novo','qualificado','convite_preparado','convite_enviado','cliente_confirmou','pedido_publicado','descartado','duplicado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qf_leads_externos_consent_chk') then
    alter table public.qf_leads_externos add constraint qf_leads_externos_consent_chk
      check (consent_status in ('nao_verificado','base_legitimo_interesse','consentido','opt_out'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qf_leads_externos_intent_chk') then
    alter table public.qf_leads_externos add constraint qf_leads_externos_intent_chk
      check (intent = 'procura_profissional');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'qf_leads_externos_https_chk') then
    alter table public.qf_leads_externos add constraint qf_leads_externos_https_chk
      check (source_url ~ '^(https://|expurgado:)');
  end if;
end $$;

create unique index if not exists qf_leads_externos_invite_token_uq
  on public.qf_leads_externos (invite_token) where invite_token is not null;
create index if not exists qf_leads_externos_status_idx on public.qf_leads_externos (status, first_seen_at desc);
create index if not exists qf_leads_externos_hash_idx on public.qf_leads_externos (content_hash) where content_hash is not null;
create index if not exists qf_leads_externos_chamado_idx on public.qf_leads_externos (confirmed_chamado_id) where confirmed_chamado_id is not null;
create index if not exists qf_leads_externos_expires_idx on public.qf_leads_externos (expires_at);
create index if not exists qf_lead_events_lead_idx on public.qf_lead_events (lead_id, created_at);

-- ---------------------------------------------------------------- fontes aprovadas
create table if not exists public.qf_lead_sources (
  id text primary key check (id ~ '^[a-z0-9_]{3,40}$'),
  label text not null,
  kind text not null check (kind in ('rss','bluesky','mastodon','manual')),
  config jsonb not null default '{}'::jsonb,
  allowed_host text,
  enabled boolean not null default false,
  authorization_note text,
  terms_url text,
  rate_limit_minutes integer not null default 180 check (rate_limit_minutes >= 15),
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_items_seen integer not null default 0,
  created_at timestamptz not null default now(),
  constraint qf_lead_sources_proof_chk check (
    enabled = false
    or (authorization_note is not null and length(btrim(authorization_note)) >= 10
        and (kind = 'manual' or allowed_host is not null))
  )
);

-- Lista de supressão: guarda só o hash da URL (nenhum dado pessoal) para não recapturar
-- publicações excluídas, descartadas ou de quem pediu para não ser contatado.
create table if not exists public.qf_lead_supressao (
  url_hash text primary key,
  motivo text not null check (motivo in ('opt_out','exclusao_lgpd','descartado')),
  criado_em timestamptz not null default now()
);

insert into public.qf_lead_sources (id, label, kind, enabled, authorization_note)
values ('manual_admin', 'Registro manual pelo administrador', 'manual', true,
        'Publicação pública consultada e registrada manualmente por um administrador do Quem Faz.')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- RLS
alter table public.qf_leads_externos enable row level security;
alter table public.qf_lead_events enable row level security;
alter table public.qf_lead_sources enable row level security;
alter table public.qf_lead_supressao enable row level security;

revoke all on public.qf_leads_externos, public.qf_lead_events, public.qf_lead_sources, public.qf_lead_supressao
  from anon, authenticated, public;

do $$
declare t text;
begin
  foreach t in array array['qf_leads_externos','qf_lead_events','qf_lead_sources','qf_lead_supressao'] loop
    execute format('drop policy if exists qf_radar_sem_acesso_direto on public.%I', t);
    execute format('create policy qf_radar_sem_acesso_direto on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- auxiliares (schema private)
create or replace function private.qf_radar_require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.qf_is_admin() then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
end $$;

create or replace function private.qf_radar_norm(p text) returns text
language sql immutable set search_path = pg_catalog as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Remove e-mail, CPF, telefone e @usuários do trecho guardado (minimização de dados).
create or replace function private.qf_radar_redact(p text) returns text
language sql immutable set search_path = pg_catalog as $$
  select left(btrim(
    regexp_replace(
    regexp_replace(
    regexp_replace(
    regexp_replace(coalesce(p, ''),
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail removido]', 'g'),
      '\d{3}\.?\d{3}\.?\d{3}-?\d{2}', '[documento removido]', 'g'),
      '(\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}', '[telefone removido]', 'g'),
      '(^|\s)@[A-Za-z0-9_.]{2,}', '\1[usuário removido]', 'g')
  ), 500);
$$;

create or replace function private.qf_radar_log(p_lead uuid, p_type text, p_actor text default 'sistema',
                                                p_note text default null, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.qf_lead_events (lead_id, event_type, actor, note, metadata)
  values (p_lead, p_type, p_actor, left(p_note, 500), coalesce(p_meta, '{}'::jsonb));
$$;

-- Liga o lead ao pedido que o cliente publicou pelo link do convite. Só leitura de qf_chamados.
create or replace function private.qf_radar_sync_pedidos() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0; r record;
begin
  for r in
    select distinct on (l.id) l.id as lead_id, c.id as chamado_id, c.criado_em
      from public.qf_leads_externos l
      join public.qf_chamados c
        on c.marketing_origem->>'source' = 'radar'
       and c.marketing_origem->>'content' = l.invite_token
     where l.invite_token is not null
       and l.confirmed_chamado_id is null
       and l.consent_status <> 'opt_out'
       and l.status <> 'duplicado'
     order by l.id, c.criado_em
  loop
    update public.qf_leads_externos
       set confirmed_chamado_id = r.chamado_id,
           confirmed_at = coalesce(confirmed_at, r.criado_em),
           status = 'pedido_publicado',
           updated_at = now()
     where id = r.lead_id and confirmed_chamado_id is null;
    if found then
      n := n + 1;
      perform private.qf_radar_log(r.lead_id, 'pedido_publicado', 'sistema', null,
                                   jsonb_build_object('chamado_id', r.chamado_id));
    end if;
  end loop;
  return n;
end $$;

-- Retenção (LGPD): descarta o que expirou sem virar pedido; anonimiza o que virou pedido após 180 dias.
create or replace function private.qf_radar_manutencao() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_expirados integer; v_anon integer; v_teste integer;
begin
  insert into public.qf_lead_supressao (url_hash, motivo)
  select encode(digest(source_url, 'sha256'), 'hex'), 'descartado'
    from public.qf_leads_externos
   where expires_at < now() and confirmed_chamado_id is null and status = 'descartado'
     and source_url like 'https://%'
  on conflict do nothing;

  with d as (
    delete from public.qf_leads_externos
     where expires_at < now() and confirmed_chamado_id is null
    returning 1)
  select count(*) into v_expirados from d;

  with d as (
    delete from public.qf_leads_externos where is_test and first_seen_at < now() - interval '7 days'
    returning 1)
  select count(*) into v_teste from d;

  with u as (
    update public.qf_leads_externos
       set excerpt = null, source_url = 'expurgado:' || id::text, metadata = '{}'::jsonb,
           content_hash = null, updated_at = now()
     where confirmed_chamado_id is not null and first_seen_at < now() - interval '180 days'
       and source_url like 'https://%'
    returning 1)
  select count(*) into v_anon from u;

  return jsonb_build_object('expirados_removidos', v_expirados, 'testes_removidos', v_teste, 'anonimizados', v_anon);
end $$;

-- ---------------------------------------------------------------- ingestão (somente service_role)
create or replace function public.qf_radar_ingest(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions, private as $$
declare
  it jsonb; src public.qf_lead_sources%rowtype;
  v_url text; v_host text; v_text text; v_hash text; v_urlhash text; v_dup uuid; v_id uuid; v_new boolean;
  v_conf numeric; v_status text;
  c_novos int := 0; c_repetidos int := 0; c_duplicados int := 0; c_suprimidos int := 0;
  c_rejeitados int := 0; c_ofertas int := 0;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items deve ser uma lista'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'lote acima de 200 itens'; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into src from public.qf_lead_sources where id = it->>'source' and enabled;
    if not found or src.kind = 'manual' then c_rejeitados := c_rejeitados + 1; continue; end if;

    v_url := it->>'source_url';
    if v_url is null or v_url !~ '^https://[^/[:space:]]+' or length(v_url) > 500 then
      c_rejeitados := c_rejeitados + 1; continue;
    end if;
    v_host := lower(substring(v_url from '^https://([^/:?#]+)'));
    if src.allowed_host is null or v_host <> lower(src.allowed_host) then
      c_rejeitados := c_rejeitados + 1; continue;
    end if;
    if coalesce(it->>'intent', '') = 'oferta_servico' then c_ofertas := c_ofertas + 1; continue; end if;
    if coalesce(it->>'intent', '') <> 'procura_profissional' or nullif(it->>'service', '') is null
       or nullif(it->>'city', '') is null then
      c_rejeitados := c_rejeitados + 1; continue;
    end if;

    v_urlhash := encode(digest(v_url, 'sha256'), 'hex');
    if exists (select 1 from public.qf_lead_supressao where url_hash = v_urlhash) then
      c_suprimidos := c_suprimidos + 1; continue;
    end if;

    v_text := private.qf_radar_redact(it->>'excerpt');
    v_hash := encode(digest(private.qf_radar_norm(v_text), 'sha256'), 'hex');
    v_conf := least(1, greatest(0, coalesce((it->>'confidence')::numeric, 0)));
    v_status := case when v_conf >= 0.70 then 'qualificado' else 'novo' end;

    select id into v_dup from public.qf_leads_externos
     where content_hash = v_hash and is_test = false and status <> 'duplicado' and source_url <> v_url
     order by first_seen_at limit 1;
    if v_dup is not null then v_status := 'duplicado'; end if;

    insert into public.qf_leads_externos
      (source, source_url, source_item_id, service, service_slug, city, neighborhood, excerpt, urgency,
       confidence, content_hash, status, duplicate_of, metadata)
    values
      (src.id, v_url, left(it->>'source_item_id', 200), left(it->>'service', 80), left(it->>'service_slug', 40),
       left(it->>'city', 80), left(nullif(it->>'neighborhood', ''), 80), v_text,
       nullif(it->>'urgency', ''), v_conf, v_hash, v_status, v_dup,
       jsonb_build_object('published_at', it->>'published_at'))
    on conflict (source, source_url) do update set last_seen_at = now()
    returning id, (xmax = 0) into v_id, v_new;

    if v_new then
      if v_status = 'duplicado' then c_duplicados := c_duplicados + 1; else c_novos := c_novos + 1; end if;
      perform private.qf_radar_log(v_id, 'capturado', 'sistema', null,
        jsonb_build_object('fonte', src.id, 'confianca', v_conf, 'duplicado_de', v_dup));
    else
      c_repetidos := c_repetidos + 1;
    end if;
  end loop;

  return jsonb_build_object('novos', c_novos, 'repetidos', c_repetidos, 'duplicados', c_duplicados,
    'suprimidos', c_suprimidos, 'rejeitados', c_rejeitados, 'ofertas_descartadas', c_ofertas);
end $$;

create or replace function public.qf_radar_fontes_ativas() returns jsonb
language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'config', config, 'allowed_host', allowed_host,
    'rate_limit_minutes', rate_limit_minutes, 'last_run_at', last_run_at) order by id), '[]'::jsonb)
  from public.qf_lead_sources where enabled and kind <> 'manual';
$$;

create or replace function public.qf_radar_fonte_resultado(p_id text, p_status text, p_erro text, p_vistos integer)
returns void language sql security definer set search_path = public as $$
  update public.qf_lead_sources
     set last_run_at = now(), last_status = left(p_status, 40), last_error = left(p_erro, 300),
         last_items_seen = greatest(0, coalesce(p_vistos, 0))
   where id = p_id;
$$;

-- ---------------------------------------------------------------- painel administrativo
create or replace function public.qf_radar_resumo() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform private.qf_radar_require_admin();
  perform private.qf_radar_sync_pedidos();
  with l as (select * from public.qf_leads_externos where not is_test and status <> 'duplicado'),
  desb as (
    select d.profissional_id, d.valor_centavos, d.origem, d.criado_em
      from public.qf_desbloqueios d join l on l.confirmed_chamado_id = d.chamado_id
     where d.ativo is true),
  primeiro as (select profissional_id, min(criado_em) as t from desb group by 1),
  rec as (
    select r.valor_centavos from public.qf_recargas r join primeiro p on p.profissional_id = r.profissional_id
     where r.status = 'aprovado' and coalesce(r.aprovado_em, r.criado_em) >= p.t)
  select jsonb_build_object(
    'encontrados', (select count(*) from l),
    'qualificados', (select count(*) from l where status in ('qualificado','convite_preparado','convite_enviado','cliente_confirmou','pedido_publicado')),
    'a_revisar', (select count(*) from l where status = 'novo'),
    'descartados', (select count(*) from l where status = 'descartado'),
    'convites_preparados', (select count(*) from l where invite_prepared_at is not null),
    'convites_enviados', (select count(*) from l where invited_at is not null),
    'clientes_confirmados', (select count(*) from l where confirmed_at is not null),
    'pedidos_publicados', (select count(*) from l where confirmed_chamado_id is not null),
    'profissionais_desbloquearam', (select count(distinct profissional_id) from desb),
    'desbloqueios', (select count(*) from desb),
    'creditos_centavos', (select coalesce(sum(valor_centavos), 0) from desb),
    'recargas_atribuiveis', (select count(*) from rec),
    'recargas_atribuiveis_centavos', (select coalesce(sum(valor_centavos), 0) from rec),
    'duplicados', (select count(*) from public.qf_leads_externos where not is_test and status = 'duplicado'),
    'testes', (select count(*) from public.qf_leads_externos where is_test),
    'por_fonte', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from l group by 1) x), '{}'::jsonb),
    'por_servico', coalesce((select jsonb_object_agg(service, n) from (select service, count(*) n from l group by 1) x), '{}'::jsonb),
    'por_cidade', coalesce((select jsonb_object_agg(city, n) from (select city, count(*) n from l group by 1) x), '{}'::jsonb),
    'fontes', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'kind', kind, 'enabled', enabled,
        'allowed_host', allowed_host, 'last_run_at', last_run_at, 'last_status', last_status,
        'last_error', last_error, 'last_items_seen', last_items_seen) order by id) from public.qf_lead_sources), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function public.qf_radar_listar(p_status text default null, p_busca text default null,
                                                  p_limite integer default 50, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total integer; v_itens jsonb; v_busca text := nullif(btrim(coalesce(p_busca, '')), '');
begin
  perform private.qf_radar_require_admin();
  select count(*) into v_total from public.qf_leads_externos l
   where (p_status is null or l.status = p_status)
     and (v_busca is null or l.service ilike '%' || v_busca || '%' or l.city ilike '%' || v_busca || '%'
          or l.source ilike '%' || v_busca || '%' or l.excerpt ilike '%' || v_busca || '%');
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_itens from (
    select jsonb_build_object(
      'id', l.id, 'source', l.source, 'source_url', l.source_url, 'service', l.service, 'city', l.city,
      'neighborhood', l.neighborhood, 'urgency', l.urgency, 'confidence', l.confidence, 'excerpt', l.excerpt,
      'status', l.status, 'consent_status', l.consent_status, 'is_test', l.is_test,
      'first_seen_at', l.first_seen_at, 'expires_at', l.expires_at, 'invite_prepared_at', l.invite_prepared_at,
      'invited_at', l.invited_at, 'invite_channel', l.invite_channel, 'confirmed_at', l.confirmed_at,
      'chamado_id', l.confirmed_chamado_id, 'duplicate_of', l.duplicate_of,
      'desbloqueios', (select count(*) from public.qf_desbloqueios d where d.chamado_id = l.confirmed_chamado_id and d.ativo is true)
    ) as x
    from public.qf_leads_externos l
    where (p_status is null or l.status = p_status)
      and (v_busca is null or l.service ilike '%' || v_busca || '%' or l.city ilike '%' || v_busca || '%'
           or l.source ilike '%' || v_busca || '%' or l.excerpt ilike '%' || v_busca || '%')
    order by l.first_seen_at desc
    limit greatest(1, least(coalesce(p_limite, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
  ) q;
  return jsonb_build_object('total', v_total, 'itens', v_itens);
end $$;

create or replace function public.qf_radar_eventos(p_lead uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform private.qf_radar_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('tipo', e.event_type, 'ator', e.actor, 'nota', e.note,
            'dados', e.metadata, 'em', e.created_at) order by e.created_at, e.id)
          from public.qf_lead_events e where e.lead_id = p_lead), '[]'::jsonb);
end $$;

create or replace function public.qf_radar_atualizar_status(p_lead uuid, p_status text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.qf_leads_externos%rowtype;
begin
  perform private.qf_radar_require_admin();
  if p_status not in ('novo','qualificado','descartado','cliente_confirmou') then
    raise exception 'status não permitido: %', p_status;
  end if;
  select * into l from public.qf_leads_externos where id = p_lead for update;
  if not found then raise exception 'lead não encontrado'; end if;
  if l.status in ('pedido_publicado','duplicado') then raise exception 'lead já encerrado: %', l.status; end if;
  update public.qf_leads_externos
     set status = p_status,
         confirmed_at = case when p_status = 'cliente_confirmou' then coalesce(confirmed_at, now()) else confirmed_at end,
         updated_at = now()
   where id = p_lead;
  perform private.qf_radar_log(p_lead, 'status_' || p_status, 'admin', p_nota, jsonb_build_object('de', l.status));
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

-- Prepara o convite (NÃO envia nada). O envio é manual até existir canal com permissão.
create or replace function public.qf_radar_preparar_convite(p_lead uuid, p_canal text default 'manual')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare l public.qf_leads_externos%rowtype; v_token text; v_link text;
begin
  perform private.qf_radar_require_admin();
  select * into l from public.qf_leads_externos where id = p_lead for update;
  if not found then raise exception 'lead não encontrado'; end if;
  if l.consent_status = 'opt_out' or l.status in ('descartado','duplicado','pedido_publicado') then
    raise exception 'não é possível preparar convite para status %', l.status;
  end if;
  v_token := coalesce(l.invite_token, encode(gen_random_bytes(9), 'hex'));
  v_link := 'https://quemfazservico.com.br/?'
         || case when l.service_slug is not null then 'servico=' || l.service_slug || '&' else '' end
         || 'utm_source=radar&utm_medium=convite&utm_campaign=radar_abc_' || coalesce(l.service_slug, 'geral')
         || '&utm_content=' || v_token;
  update public.qf_leads_externos
     set invite_token = v_token, invite_channel = left(coalesce(p_canal, 'manual'), 40),
         invite_prepared_at = coalesce(invite_prepared_at, now()),
         status = case when status in ('novo','qualificado') then 'convite_preparado' else status end,
         updated_at = now()
   where id = p_lead;
  perform private.qf_radar_log(p_lead, 'convite_preparado', 'admin', null, jsonb_build_object('canal', p_canal));
  return jsonb_build_object('ok', true, 'token', v_token, 'link', v_link, 'servico', l.service, 'cidade', l.city);
end $$;

create or replace function public.qf_radar_marcar_convite_enviado(p_lead uuid, p_canal text default 'manual', p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l public.qf_leads_externos%rowtype;
begin
  perform private.qf_radar_require_admin();
  select * into l from public.qf_leads_externos where id = p_lead for update;
  if not found then raise exception 'lead não encontrado'; end if;
  if l.invite_token is null then raise exception 'prepare o convite antes de marcar como enviado'; end if;
  if l.consent_status = 'opt_out' or l.status in ('descartado','duplicado') then
    raise exception 'convite não permitido para status %', l.status;
  end if;
  update public.qf_leads_externos
     set invited_at = coalesce(invited_at, now()), invite_channel = left(coalesce(p_canal, invite_channel, 'manual'), 40),
         status = case when status in ('novo','qualificado','convite_preparado') then 'convite_enviado' else status end,
         updated_at = now()
   where id = p_lead;
  perform private.qf_radar_log(p_lead, 'convite_enviado', 'admin', p_nota, jsonb_build_object('canal', p_canal));
  return jsonb_build_object('ok', true);
end $$;

-- Registro manual de uma publicação pública que o administrador encontrou e revisou.
create or replace function public.qf_radar_registrar_manual(
  p_url text, p_trecho text, p_servico text, p_slug text, p_cidade text,
  p_bairro text default null, p_urgencia text default null, p_teste boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions, private as $$
declare v_url text := btrim(coalesce(p_url, '')); v_text text; v_hash text; v_id uuid; v_new boolean; v_dup uuid;
begin
  perform private.qf_radar_require_admin();
  if v_url !~ '^https://[^/[:space:]]+' or length(v_url) > 500 then raise exception 'informe um link https válido'; end if;
  if nullif(btrim(p_servico), '') is null or nullif(btrim(p_cidade), '') is null then
    raise exception 'serviço e cidade são obrigatórios';
  end if;
  if exists (select 1 from public.qf_lead_supressao where url_hash = encode(digest(v_url, 'sha256'), 'hex')) then
    raise exception 'esta publicação está na lista de supressão (opt-out ou exclusão)';
  end if;
  v_text := private.qf_radar_redact(p_trecho);
  v_hash := encode(digest(private.qf_radar_norm(v_text), 'sha256'), 'hex');
  if not coalesce(p_teste, false) then
    select id into v_dup from public.qf_leads_externos
     where content_hash = v_hash and not is_test and status <> 'duplicado' and source_url <> v_url limit 1;
  end if;
  insert into public.qf_leads_externos
    (source, source_url, service, service_slug, city, neighborhood, excerpt, urgency, confidence,
     content_hash, status, duplicate_of, is_test, expires_at, metadata)
  values
    ('manual_admin', v_url,
     left(btrim(p_servico), 80), left(nullif(btrim(coalesce(p_slug, '')), ''), 40), left(btrim(p_cidade), 80),
     left(nullif(btrim(coalesce(p_bairro, '')), ''), 80), v_text, nullif(btrim(coalesce(p_urgencia, '')), ''), 1.00,
     v_hash, case when v_dup is not null then 'duplicado' else 'qualificado' end, v_dup, coalesce(p_teste, false),
     case when coalesce(p_teste, false) then now() + interval '7 days' else now() + interval '30 days' end,
     jsonb_build_object('registro', 'manual'))
  on conflict (source, source_url) do update set last_seen_at = now()
  returning id, (xmax = 0) into v_id, v_new;
  if v_new then
    perform private.qf_radar_log(v_id, case when coalesce(p_teste, false) then 'registro_teste' else 'registro_manual' end, 'admin');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'novo', v_new, 'duplicado_de', v_dup);
end $$;

-- LGPD: exclusão / opt-out. Remove o lead e o histórico; guarda só o hash da URL para não recapturar.
create or replace function public.qf_radar_excluir(p_lead uuid, p_motivo text default 'exclusao_lgpd')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_url text;
begin
  perform private.qf_radar_require_admin();
  if p_motivo not in ('opt_out','exclusao_lgpd','descartado') then raise exception 'motivo inválido'; end if;
  select source_url into v_url from public.qf_leads_externos where id = p_lead;
  if not found then raise exception 'lead não encontrado'; end if;
  if v_url like 'https://%' then
    insert into public.qf_lead_supressao (url_hash, motivo) values (encode(digest(v_url, 'sha256'), 'hex'), p_motivo)
    on conflict (url_hash) do nothing;
  end if;
  delete from public.qf_leads_externos where id = p_lead;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.qf_radar_fonte_definir(p_id text, p_ativo boolean, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform private.qf_radar_require_admin();
  update public.qf_lead_sources
     set enabled = p_ativo, authorization_note = coalesce(nullif(btrim(p_nota), ''), authorization_note)
   where id = p_id and kind <> 'manual';
  if not found then raise exception 'fonte não encontrada'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- permissões das funções
revoke all on function private.qf_radar_require_admin(), private.qf_radar_norm(text), private.qf_radar_redact(text),
  private.qf_radar_log(uuid, text, text, text, jsonb), private.qf_radar_sync_pedidos(), private.qf_radar_manutencao()
  from public, anon, authenticated;

revoke all on function public.qf_radar_ingest(jsonb), public.qf_radar_fontes_ativas(),
  public.qf_radar_fonte_resultado(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.qf_radar_ingest(jsonb), public.qf_radar_fontes_ativas(),
  public.qf_radar_fonte_resultado(text, text, text, integer) to service_role;

revoke all on function public.qf_radar_resumo(), public.qf_radar_listar(text, text, integer, integer),
  public.qf_radar_eventos(uuid), public.qf_radar_atualizar_status(uuid, text, text),
  public.qf_radar_preparar_convite(uuid, text), public.qf_radar_marcar_convite_enviado(uuid, text, text),
  public.qf_radar_registrar_manual(text, text, text, text, text, text, text, boolean),
  public.qf_radar_excluir(uuid, text), public.qf_radar_fonte_definir(text, boolean, text) from public, anon;
grant execute on function public.qf_radar_resumo(), public.qf_radar_listar(text, text, integer, integer),
  public.qf_radar_eventos(uuid), public.qf_radar_atualizar_status(uuid, text, text),
  public.qf_radar_preparar_convite(uuid, text), public.qf_radar_marcar_convite_enviado(uuid, text, text),
  public.qf_radar_registrar_manual(text, text, text, text, text, text, text, boolean),
  public.qf_radar_excluir(uuid, text), public.qf_radar_fonte_definir(text, boolean, text) to authenticated;

-- ---------------------------------------------------------------- rotinas agendadas (somente banco)
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('qf-radar-sync-pedidos', 'qf-radar-manutencao');
  perform cron.schedule('qf-radar-sync-pedidos', '*/10 * * * *', 'select private.qf_radar_sync_pedidos()');
  perform cron.schedule('qf-radar-manutencao', '23 3 * * *', 'select private.qf_radar_manutencao()');
exception when others then
  raise notice 'pg_cron indisponível: agende qf-radar-sync-pedidos e qf-radar-manutencao manualmente (%).', sqlerrm;
end $$;
