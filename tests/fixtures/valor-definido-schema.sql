-- Esquema mínimo, com as mesmas colunas e restrições de produção, para testar
-- supabase/2026-10-18-pedidos-valor-definido-qr.sql em um Postgres isolado (PGlite ou Postgres 16).
-- As funções reais de produção usadas pelo desbloqueio tradicional vêm de commercial-production-functions.sql.
set check_function_bodies = off;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema if not exists auth; create schema if not exists private; create schema if not exists qf_private;
grant usage on schema public, auth, private, qf_private to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function private.qf_is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin', true), '') = 'true' $$;

create table public.qf_config (chave text primary key, valor jsonb not null, atualizado_em timestamptz not null default now());
insert into public.qf_config (chave, valor) values ('devolucao_lead', '{"ativo": true}');  -- ligado de propósito: prova a guarda

create table public.qf_profiles (id uuid primary key, tipo text, nome text, nome_fantasia text, foto_url text, ativo boolean default true, telefone text, whatsapp text);
create table public.qf_profissionais (user_id uuid primary key, especialidades text[], online boolean default true, raio_km integer default 20,
  latitude numeric, longitude numeric, avaliacao_media numeric, total_avaliacoes integer default 0, atualizado_em timestamptz default now());
create table public.qf_chamados (
  id uuid primary key default gen_random_uuid(), cliente_id uuid not null, categoria text, titulo text, descricao text,
  cidade text, uf char(2), bairro text, latitude numeric, longitude numeric,
  status text not null default 'aberto', desfecho text, desfecho_em timestamptz,
  max_orcamentos integer not null default 3, prioridade boolean default false, urgencia text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  constraint qf_chamados_status_check check (status = any (array['aberto','em_negociacao','confirmado','em_andamento','concluido','finalizado','cancelado','expirado','aguardando_pagamento'])),
  constraint qf_chamados_desfecho_check check (desfecho is null or desfecho = any (array['fechado','nao_fechado','sem_retorno'])),
  constraint qf_chamados_max_orcamentos_check check (max_orcamentos >= 1 and max_orcamentos <= 4));
create table public.qf_desbloqueios (
  id uuid primary key default gen_random_uuid(), chamado_id uuid, profissional_id uuid, valor_centavos integer, origem text,
  criado_em timestamptz default now(), ativo boolean default true, plano_id uuid, desfecho text, desfecho_em timestamptz, exclusivo boolean default false,
  unique (chamado_id, profissional_id),
  constraint qf_desbloqueios_desfecho_check check (desfecho is null or desfecho = any (array['fechado','nao_fechado'])),
  constraint qf_desbloqueios_origem_check check (origem = any (array['saldo','bonus','cortesia_admin','plano'])),
  constraint qf_desbloqueios_valor_centavos_check check (valor_centavos >= 0));
create table public.qf_carteiras (profissional_id uuid primary key, saldo_centavos bigint not null default 0, bonus_inicial_centavos bigint default 0, bonus_inicial_usado boolean default false, atualizado_em timestamptz default now());
create table public.qf_movimentacoes_carteira (id uuid primary key default gen_random_uuid(), profissional_id uuid, tipo text, valor_centavos bigint, referencia_tipo text, referencia_id uuid, descricao text, criado_em timestamptz default now(),
  constraint qf_movimentacoes_carteira_tipo_check check (tipo = any (array['credito','debito','bonus','estorno','ajuste_admin'])),
  constraint qf_movimentacoes_carteira_valor_centavos_check check (valor_centavos > 0));
create table public.qf_avaliacoes (id uuid primary key default gen_random_uuid(), chamado_id uuid, cliente_id uuid, profissional_id uuid, nota integer, comentario text, criado_em timestamptz default now(), autor_tipo text,
  constraint qf_avaliacoes_autor_tipo_check check (autor_tipo = any (array['cliente','profissional'])), constraint qf_avaliacoes_nota_check check (nota >= 1 and nota <= 5));
create unique index uq_qf_avaliacoes_chamado_autor on public.qf_avaliacoes (chamado_id, autor_tipo);
create table public.qf_carteirinhas (profissional_id uuid primary key, token uuid not null default gen_random_uuid(), numero bigint generated always as identity, criado_em timestamptz default now());
create table public.qf_profissional_avisos (id uuid primary key default gen_random_uuid(), user_id uuid, chamado_id uuid, tipo text, titulo text, corpo text, rota text, criado_em timestamptz default now(), unique (user_id, chamado_id, tipo));
create table public.qf_devolucoes_lead (id uuid primary key default gen_random_uuid(), desbloqueio_id uuid unique, chamado_id uuid, profissional_id uuid, valor_centavos integer, motivo text, criado_em timestamptz default now());
create table public.qf_precos_desbloqueio (categoria text primary key, preco_centavos integer, ativo boolean default true);
create table public.qf_planos_profissional (id uuid default gen_random_uuid(), profissional_id uuid, chamados_restantes integer, valido_ate timestamptz, atualizado_em timestamptz);
create table public.qf_orcamentos (id uuid default gen_random_uuid(), chamado_id uuid, profissional_id uuid, status text);
create table public.qf_chat_mensagens (chamado_id uuid, profissional_id uuid, remetente_id uuid, tipo text, criado_em timestamptz default now());
create table private.test_dispatch (evento text, chamado uuid);

create or replace function private.qf_push_interno(e text, c uuid) returns void language sql as $$ insert into private.test_dispatch values (e, c) $$;
create or replace function private.qf_pendencia_finalizacao(uuid, text) returns uuid language sql as $$ select null::uuid $$;
create or replace function private.qf_expirar_bonus_profissional(uuid) returns void language sql as $$ select $$;
create or replace function public.qf_exclusivo_info() returns jsonb language sql as $$ select '{"ativo":false}'::jsonb $$;
create or replace function public.qf_distancia_km(a numeric, b numeric, c numeric, d numeric) returns numeric language sql immutable as $$ select 111 * sqrt(power(c - a, 2) + power(d - b, 2)) $$;
-- Elegibilidade (profissão + raio), como na vitrine real: pedido aberto/em negociação, profissão cadastrada, dentro do raio.
create or replace function public.qf_listar_chamados_disponiveis() returns table (id uuid) language sql stable security definer set search_path = '' as $$
  select c.id from public.qf_chamados c join public.qf_profissionais p on p.user_id = auth.uid()
   where c.status in ('aberto', 'em_negociacao') and c.categoria = any (p.especialidades)
     and public.qf_distancia_km(p.latitude, p.longitude, c.latitude, c.longitude) <= coalesce(p.raio_km, 20)
$$;

-- Gatilho real de produção: cancelamento do pedido tenta devolver o lead.
create or replace function qf_private.devolver_leads_no_cancelamento() returns trigger language plpgsql security definer set search_path = '' as $function$
declare r record; v_cliente_respondeu boolean;
begin
  if new.status not in ('cancelado','expirado') or old.status not in ('aberto','em_negociacao') then return new; end if;
  for r in select d.id, d.profissional_id, d.criado_em from public.qf_desbloqueios d
            where d.chamado_id = new.id and d.ativo
              and not exists (select 1 from public.qf_orcamentos o where o.chamado_id = d.chamado_id and o.profissional_id = d.profissional_id and o.status = 'aceito')
            for update
  loop
    select exists (select 1 from public.qf_chat_mensagens m where m.chamado_id = new.id and m.profissional_id = r.profissional_id
                    and m.remetente_id = new.cliente_id and m.tipo = 'mensagem' and m.criado_em >= r.criado_em) into v_cliente_respondeu;
    if not v_cliente_respondeu then
      perform qf_private.devolver_lead(r.id, case when new.status = 'expirado' then 'chamado_expirou' else 'cliente_cancelou' end);
    end if;
    update public.qf_desbloqueios set ativo = false where id = r.id and ativo;
  end loop;
  return new;
end $function$;
create trigger qf_devolver_leads_after_cancel after update on public.qf_chamados for each row execute function qf_private.devolver_leads_no_cancelamento();

-- devolver_lead ORIGINAL de produção (a migração o substitui por uma versão com guarda).
create or replace function qf_private.devolver_lead(p_desbloqueio_id uuid, p_motivo text) returns integer language plpgsql security definer set search_path = '' as $function$
declare d public.qf_desbloqueios; v_id uuid; v_txt text;
begin
  if not coalesce((select (c.valor->>'ativo')::boolean from public.qf_config c where c.chave = 'devolucao_lead'), true) then return 0; end if;
  select * into d from public.qf_desbloqueios where id = p_desbloqueio_id for update;
  if d.id is null then return 0; end if;
  v_txt := 'Devolução do lead: o cliente cancelou o pedido';
  if coalesce(d.valor_centavos, 0) <= 0 or d.origem <> 'saldo' then return 0; end if;
  if not exists (select 1 from public.qf_movimentacoes_carteira m where m.profissional_id = d.profissional_id and m.tipo = 'debito' and m.referencia_tipo = 'chamado' and m.referencia_id = d.chamado_id) then return 0; end if;
  insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo) values (d.id, d.chamado_id, d.profissional_id, d.valor_centavos, p_motivo)
  on conflict (desbloqueio_id) do nothing returning id into v_id;
  if v_id is null then return 0; end if;
  update public.qf_carteiras set saldo_centavos = saldo_centavos + d.valor_centavos where profissional_id = d.profissional_id;
  insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao) values (d.profissional_id, 'estorno', d.valor_centavos, 'chamado', d.chamado_id, v_txt);
  update public.qf_desbloqueios set ativo = false where id = d.id;
  return d.valor_centavos;
end $function$;
CREATE OR REPLACE FUNCTION public.qf_limite_orcamentos(p_chamado_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when exists(select 1 from public.qf_desbloqueios d where d.chamado_id = p_chamado_id and d.exclusivo and coalesce(d.ativo, true)) then 1
    else least(4, coalesce((select c.max_orcamentos from public.qf_chamados c where c.id = p_chamado_id), 3))
  end;
$function$;

CREATE OR REPLACE FUNCTION private.qf_pro_atende_regiao(p_pro uuid, p_cidade text, p_uf text, p_lat numeric, p_lng numeric)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.qf_profissionais pr
 where pr.user_id=p_pro
 and pr.latitude between -90 and 90 and pr.longitude between -180 and 180
 and not (pr.latitude=0 and pr.longitude=0)
 and p_lat between -90 and 90 and p_lng between -180 and 180
 and not (p_lat=0 and p_lng=0)
 and public.qf_distancia_km(pr.latitude,pr.longitude,p_lat,p_lng)<=coalesce(pr.raio_km,20));
$function$;

CREATE OR REPLACE FUNCTION public.qf_desbloquear_chamado(p_chamado_id uuid, p_exclusivo boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prof uuid := auth.uid();
  v_preco integer;
  v_preco_tabela integer;
  v_saldo bigint;
  v_status text;
  v_existing_valor integer;
  v_existing_origem text;
  v_existing_ativo boolean;
  v_plano_id uuid;
  v_plano_restantes integer;
  v_pendencia uuid;
  v_participantes integer := 0;
  v_excl jsonb;
  v_exclusivo boolean := coalesce(p_exclusivo, false);
begin
  if v_prof is null then
    raise exception 'authentication required';
  end if;

  if not exists(select 1 from public.qf_profissionais where user_id=v_prof) then
    raise exception 'professional profile required';
  end if;

  v_pendencia := private.qf_pendencia_finalizacao(v_prof,'profissional');
  if v_pendencia is not null then
    return jsonb_build_object('ok',false,'reason','avaliacao_pendente','chamado_id',v_pendencia);
  end if;

  if not exists(
    select 1 from public.qf_profiles
    where id=v_prof
      and nullif(trim(coalesce(foto_url,'')),'') is not null
  ) then
    return jsonb_build_object('ok',false,'reason','selfie_obrigatoria');
  end if;

  select d.valor_centavos,d.origem,d.ativo
    into v_existing_valor,v_existing_origem,v_existing_ativo
  from public.qf_desbloqueios d
  where d.chamado_id=p_chamado_id
    and d.profissional_id=v_prof
  limit 1;

  if found then
    if coalesce(v_existing_ativo,true) then
      return jsonb_build_object(
        'ok',true,'already_unlocked',true,
        'origem',coalesce(v_existing_origem,'saldo'),
        'preco_centavos',coalesce(v_existing_valor,0),
        'usou_bonus',v_existing_origem='cortesia_admin',
        'participantes',(select count(*)::integer from public.qf_desbloqueios x where x.chamado_id=p_chamado_id and coalesce(x.ativo,true)),'limite',public.qf_limite_orcamentos(p_chamado_id)
      );
    end if;
    return jsonb_build_object('ok',false,'reason','ja_participou');
  end if;

  select c.status,coalesce(p.preco_centavos,padrao.preco_centavos,790)
    into v_status,v_preco_tabela
  from public.qf_chamados c
  left join public.qf_precos_desbloqueio p
    on p.categoria=c.categoria and p.ativo
  left join public.qf_precos_desbloqueio padrao
    on padrao.categoria='padrao'
  where c.id=p_chamado_id
  for update of c;

  if v_status is null then
    raise exception 'call not found';
  end if;

  if v_status not in ('aberto','em_negociacao') then
    return jsonb_build_object('ok',false,'reason','indisponivel');
  end if;

  if exists(
    select 1 from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id and o.status='aceito'
  ) then
    return jsonb_build_object('ok',false,'reason','indisponivel');
  end if;

  select count(*)::integer into v_participantes
  from public.qf_desbloqueios d
  where d.chamado_id=p_chamado_id
    and coalesce(d.ativo,true);

  if v_participantes >= public.qf_limite_orcamentos(p_chamado_id) then
    return jsonb_build_object(
      'ok',false,'reason','reservado','lotado',true,
      'participantes',v_participantes,'limite',public.qf_limite_orcamentos(p_chamado_id),
      'message','As vagas deste pedido já foram preenchidas.'
    );
  end if;

  v_preco := v_preco_tabela;
  if v_exclusivo then
    v_excl := public.qf_exclusivo_info();
    if not coalesce((v_excl->>'ativo')::boolean, false) then
      return jsonb_build_object('ok',false,'reason','exclusivo_desligado');
    end if;
    if v_participantes > 0 then
      return jsonb_build_object('ok',false,'reason','exclusivo_indisponivel','participantes',v_participantes);
    end if;
    v_preco := ceil(v_preco_tabela * coalesce((v_excl->>'multiplicador')::numeric, 3))::integer;
  end if;

  if not exists(
    select 1 from public.qf_listar_chamados_disponiveis() d
    where d.id=p_chamado_id
  ) then
    return jsonb_build_object('ok',false,'reason','nao_elegivel');
  end if;

  if not v_exclusivo then
    select id,chamados_restantes
      into v_plano_id,v_plano_restantes
    from public.qf_planos_profissional
    where profissional_id=v_prof
      and valido_ate>now()
      and chamados_restantes>0
    order by valido_ate asc
    limit 1
    for update;

    if v_plano_id is not null then
      update public.qf_planos_profissional
         set chamados_restantes=chamados_restantes-1,
             atualizado_em=now()
       where id=v_plano_id;

      insert into public.qf_desbloqueios(
        chamado_id,profissional_id,valor_centavos,origem,ativo,plano_id
      )
      values(p_chamado_id,v_prof,0,'plano',true,v_plano_id);

      update public.qf_chamados
         set status='em_negociacao',atualizado_em=now()
       where id=p_chamado_id;

      perform private.qf_push_interno('professional_connected',p_chamado_id);

      return jsonb_build_object(
        'ok',true,'origem','plano','usou_bonus',false,'exclusivo',false,
        'preco_centavos',0,'preco_tabela_centavos',v_preco_tabela,
        'plano_restantes',v_plano_restantes-1,
        'participantes',(select count(*)::integer from public.qf_desbloqueios x where x.chamado_id=p_chamado_id and coalesce(x.ativo,true)),'limite',public.qf_limite_orcamentos(p_chamado_id)
      );
    end if;
  end if;

  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(v_prof,0,0,true)
  on conflict(profissional_id) do update
    set bonus_inicial_usado=true;

  perform private.qf_expirar_bonus_profissional(v_prof);

  select saldo_centavos into v_saldo
  from public.qf_carteiras
  where profissional_id=v_prof
  for update;

  if coalesce(v_saldo,0)<v_preco then
    return jsonb_build_object(
      'ok',false,'reason','saldo_insuficiente','exclusivo',v_exclusivo,
      'preco_centavos',v_preco,'saldo_centavos',coalesce(v_saldo,0)
    );
  end if;

  update public.qf_carteiras
     set saldo_centavos=saldo_centavos-v_preco,
         atualizado_em=now()
   where profissional_id=v_prof;

  insert into public.qf_movimentacoes_carteira(
    profissional_id,tipo,valor_centavos,referencia_tipo,referencia_id,descricao
  )
  values(v_prof,'debito',v_preco,'chamado',p_chamado_id,
         case when v_exclusivo then 'Desbloqueio exclusivo de chamado' else 'Desbloqueio de chamado' end);

  insert into public.qf_desbloqueios(
    chamado_id,profissional_id,valor_centavos,origem,ativo,exclusivo
  )
  values(p_chamado_id,v_prof,v_preco,'saldo',true,v_exclusivo);

  update public.qf_chamados
     set status='em_negociacao',atualizado_em=now()
   where id=p_chamado_id;

  perform private.qf_push_interno('professional_connected',p_chamado_id);

  return jsonb_build_object(
    'ok',true,'origem','saldo','usou_bonus',false,'exclusivo',v_exclusivo,
    'preco_centavos',v_preco,'preco_tabela_centavos',v_preco_tabela,
    'saldo_centavos',v_saldo-v_preco,
    'participantes',(select count(*)::integer from public.qf_desbloqueios x where x.chamado_id=p_chamado_id and coalesce(x.ativo,true)),'limite',public.qf_limite_orcamentos(p_chamado_id)
  );
exception
  when unique_violation then
    return jsonb_build_object('ok',false,'reason','reservado');
end;
$function$;
