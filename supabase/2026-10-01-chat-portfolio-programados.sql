-- QuemFaz 11.15.1
-- Chat após desbloqueio, portfólio de serviços programados, limite de 5 participantes
-- e disparo forte somente nas 24h anteriores à execução.
-- Este arquivo registra o estado aplicado em produção em 2026-10-01.

create table if not exists public.qf_chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.qf_chamados(id) on delete cascade,
  profissional_id uuid not null references public.qf_profiles(id) on delete cascade,
  remetente_id uuid not null references public.qf_profiles(id) on delete cascade,
  mensagem text not null,
  tipo text not null default 'mensagem',
  lida_em timestamptz,
  criado_em timestamptz not null default now(),
  constraint qf_chat_mensagem_tamanho check (char_length(trim(mensagem)) between 1 and 1500),
  constraint qf_chat_tipo_valido check (tipo in ('mensagem','sistema'))
);

create index if not exists qf_chat_mensagens_conversa_idx
  on public.qf_chat_mensagens(chamado_id, profissional_id, criado_em);
create index if not exists qf_chat_mensagens_nao_lidas_idx
  on public.qf_chat_mensagens(chamado_id, profissional_id, lida_em)
  where lida_em is null;

alter table public.qf_chat_mensagens enable row level security;
revoke all on public.qf_chat_mensagens from anon, authenticated;

CREATE OR REPLACE FUNCTION private.qf_alertar_chamados_parados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; n int := 0;
begin
  for r in
    with novos as (
      insert into public.qf_chamado_alertas (chamado_id, tipo)
      select c.id,'parado_10min'
      from public.qf_chamados c
      where c.status='aberto'
        and (c.data_preferida is null or c.data_preferida<=now()+interval '24 hours')
        and (
          case
            when c.data_preferida is not null
              and c.data_preferida-interval '24 hours'>c.criado_em
            then c.data_preferida-interval '24 hours'
            else c.criado_em
          end
        ) <= now()-interval '10 minutes'
        and (
          case
            when c.data_preferida is not null
              and c.data_preferida-interval '24 hours'>c.criado_em
            then c.data_preferida-interval '24 hours'
            else c.criado_em
          end
        ) >= now()-interval '3 hours'
        and not exists (
          select 1 from public.qf_desbloqueios d where d.chamado_id=c.id
        )
      on conflict do nothing
      returning chamado_id
    )
    select chamado_id from novos
  loop
    perform private.qf_push_interno('stale_call',r.chamado_id);
    n:=n+1;
  end loop;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION private.qf_alertar_programados_24h()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  n integer := 0;
begin
  for r in
    select c.id
    from public.qf_chamados c
    where c.status in ('aberto','em_negociacao')
      and c.data_preferida is not null
      and c.data_preferida <= now()+interval '24 hours'
      and not exists (
        select 1 from public.qf_chamado_alertas a
        where a.chamado_id=c.id and a.tipo='programado_24h'
      )
      and not exists (
        select 1 from public.qf_orcamentos o
        where o.chamado_id=c.id and o.status='aceito'
      )
    order by c.data_preferida
    for update of c skip locked
  loop
    insert into public.qf_chamado_alertas(chamado_id,tipo)
    values(r.id,'programado_24h')
    on conflict do nothing;

    update public.qf_chamado_cascata
       set etapa=1,etapa1_em=now(),etapa2_em=null,etapa3_em=null,
           etapa2_destinatarios=0,etapa2_enviados=0,
           aceito_etapa=null,aceito_em=null,aceito_por=null,aceito_online=null,
           atualizado_em=now()
     where chamado_id=r.id;

    perform private.qf_push_interno('new_call',r.id);
    n := n+1;
  end loop;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION private.qf_cascata_tick()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      select k.chamado_id
      from public.qf_chamado_cascata k
      join public.qf_chamados c on c.id=k.chamado_id
      where k.etapa=1
        and k.aceito_em is null
        and c.status in ('aberto','em_negociacao')
        and (c.data_preferida is null or c.data_preferida<=now()+interval '24 hours')
        and k.etapa1_em<=now()-make_interval(secs=>v_x)
        and k.etapa1_em>=now()-interval '1 day'
        and not exists(
          select 1 from public.qf_orcamentos o
          where o.chamado_id=c.id and o.status='aceito'
        )
        and (
          select count(*) from public.qf_desbloqueios d
          where d.chamado_id=c.id and coalesce(d.ativo,true)
        )<5
      for update of k skip locked
    )
    update public.qf_chamado_cascata k
       set etapa=2,etapa2_em=now(),atualizado_em=now()
      from alvo
     where k.chamado_id=alvo.chamado_id
    returning k.chamado_id
  loop
    perform private.qf_push_interno('cascade_stage2',r.chamado_id);
    n:=n+1;
  end loop;

  for r in
    with alvo as (
      select k.chamado_id
      from public.qf_chamado_cascata k
      join public.qf_chamados c on c.id=k.chamado_id
      where k.etapa=2
        and k.aceito_em is null
        and c.status in ('aberto','em_negociacao')
        and (c.data_preferida is null or c.data_preferida<=now()+interval '24 hours')
        and k.etapa1_em<=now()-make_interval(mins=>v_y)
        and k.etapa2_em<=now()-interval '5 seconds'
        and k.etapa1_em>=now()-interval '1 day'
        and not exists(
          select 1 from public.qf_orcamentos o
          where o.chamado_id=c.id and o.status='aceito'
        )
        and (
          select count(*) from public.qf_desbloqueios d
          where d.chamado_id=c.id and coalesce(d.ativo,true)
        )<5
      for update of k skip locked
    )
    update public.qf_chamado_cascata k
       set etapa=3,etapa3_em=now(),atualizado_em=now()
      from alvo
     where k.chamado_id=alvo.chamado_id
    returning k.chamado_id
  loop
    perform private.qf_push_interno('cascade_stage3',r.chamado_id);
    n:=n+1;
  end loop;

  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION private.qf_expirar_chamados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n integer;
begin
  with alvo as (
    select c.id
    from public.qf_chamados c
    where c.status in ('aberto','em_negociacao')
      and c.criado_em<now()-interval '3 days'
      and c.atualizado_em<now()-interval '3 days'
      and (c.data_preferida is null or c.data_preferida<now()-interval '3 days')
      and not (
        coalesce(c.prioridade,false)
        and c.prioridade_ate is not null
        and c.prioridade_ate>now()
      )
      and not exists (
        select 1 from public.qf_orcamentos o
        where o.chamado_id=c.id
          and greatest(o.criado_em,o.atualizado_em)>now()-interval '3 days'
      )
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id=c.id and d.criado_em>now()-interval '3 days'
      )
    for update skip locked
  )
  update public.qf_chamados c
     set status='expirado',atualizado_em=now()
    from alvo
   where c.id=alvo.id;
  get diagnostics v_n=row_count;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION private.qf_reabrir_busca()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if old.status is distinct from 'aberto' and new.status='aberto' then
    insert into public.qf_chamado_cascata(
      chamado_id, etapa, etapa1_em, etapa2_em, etapa3_em,
      etapa2_destinatarios, etapa2_enviados,
      aceito_etapa, aceito_em, aceito_por, aceito_online,
      atualizado_em, oculto_admin, rodada
    )
    values(
      new.id,1,now(),null,null,0,0,null,null,null,null,now(),false,1
    )
    on conflict(chamado_id) do update set
      etapa=1,etapa1_em=now(),etapa2_em=null,etapa3_em=null,
      etapa2_destinatarios=0,etapa2_enviados=0,
      aceito_etapa=null,aceito_em=null,aceito_por=null,aceito_online=null,
      atualizado_em=now(),oculto_admin=false,
      rodada=public.qf_chamado_cascata.rodada+1;

    if new.data_preferida is null or new.data_preferida<=now()+interval '24 hours' then
      insert into public.qf_chamado_alertas(chamado_id,tipo)
      values(new.id,'programado_24h')
      on conflict do nothing;
      perform private.qf_push_interno('new_call',new.id);
    end if;
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz reabrir busca: %',sqlerrm;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_chat_conversa(p_chamado_id uuid, p_profissional_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, chamado_id uuid, profissional_id uuid, remetente_id uuid, remetente_nome text, remetente_tipo text, mensagem text, tipo text, lida_em timestamp with time zone, criado_em timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_cliente uuid;
  v_prof uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;

  select c.cliente_id into v_cliente
  from public.qf_chamados c
  where c.id=p_chamado_id;

  if v_cliente is null then raise exception 'call not found'; end if;

  if v_user=v_cliente then
    v_prof := p_profissional_id;
    if v_prof is null then raise exception 'professional required'; end if;
  else
    v_prof := coalesce(p_profissional_id,v_user);
    if v_prof<>v_user then raise exception 'forbidden'; end if;
  end if;

  if not exists(
    select 1 from public.qf_desbloqueios d
    where d.chamado_id=p_chamado_id
      and d.profissional_id=v_prof
      and coalesce(d.ativo,true)
  ) then
    raise exception 'conversation unavailable';
  end if;

  if v_user<>v_cliente and v_user<>v_prof then raise exception 'forbidden'; end if;

  update public.qf_chat_mensagens m
     set lida_em=now()
   where m.chamado_id=p_chamado_id
     and m.profissional_id=v_prof
     and m.remetente_id<>v_user
     and m.lida_em is null;

  return query
  select
    m.id,m.chamado_id,m.profissional_id,m.remetente_id,
    p.nome,
    case when m.remetente_id=v_cliente then 'cliente'::text else 'profissional'::text end,
    m.mensagem,m.tipo,m.lida_em,m.criado_em
  from public.qf_chat_mensagens m
  join public.qf_profiles p on p.id=m.remetente_id
  where m.chamado_id=p_chamado_id
    and m.profissional_id=v_prof
  order by m.criado_em asc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_cliente_conversas(p_chamado_id uuid)
 RETURNS TABLE(profissional_id uuid, profissional_nome text, profissional_foto_url text, profissional_verificado boolean, profissional_cidade text, profissional_uf character, profissional_avaliacao numeric, profissional_total_avaliacoes integer, profissional_telefone text, profissional_whatsapp text, mensagens integer, nao_lidas integer, ultima_mensagem text, ultima_em timestamp with time zone, selecionado boolean, tem_proposta boolean, proposta_valor_centavos integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with alvo as (
    select c.id,c.cliente_id
    from public.qf_chamados c
    where c.id=p_chamado_id and c.cliente_id=auth.uid()
  ),
  participantes as (
    select distinct d.profissional_id
    from public.qf_desbloqueios d
    join alvo a on a.id=d.chamado_id
    where coalesce(d.ativo,true)
  )
  select
    d.profissional_id,
    p.nome,
    p.foto_url,
    pr.verificado,
    p.cidade,
    p.uf,
    pr.avaliacao_media,
    pr.total_avaliacoes,
    case when coalesce(sel.selecionado,false) then p.telefone else null::text end,
    case when coalesce(sel.selecionado,false) then p.whatsapp else null::text end,
    coalesce(msg.total,0)::integer,
    coalesce(msg.nao_lidas,0)::integer,
    msg.ultima_mensagem,
    msg.ultima_em,
    coalesce(sel.selecionado,false),
    coalesce(prop.tem_proposta,false),
    prop.valor_centavos
  from participantes d
  join public.qf_profiles p on p.id=d.profissional_id
  join public.qf_profissionais pr on pr.user_id=d.profissional_id
  left join lateral (
    select true as selecionado
    from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id
      and o.profissional_id=d.profissional_id
      and o.status='aceito'
    order by o.atualizado_em desc
    limit 1
  ) sel on true
  left join lateral (
    select
      count(*)::integer as total,
      count(*) filter (
        where m.remetente_id=d.profissional_id and m.lida_em is null
      )::integer as nao_lidas,
      (array_agg(m.mensagem order by m.criado_em desc))[1] as ultima_mensagem,
      max(m.criado_em) as ultima_em
    from public.qf_chat_mensagens m
    where m.chamado_id=p_chamado_id
      and m.profissional_id=d.profissional_id
  ) msg on true
  left join lateral (
    select
      (o.status in ('enviado','aceito')) as tem_proposta,
      o.valor_centavos
    from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id
      and o.profissional_id=d.profissional_id
      and o.status <> 'cancelado'
    order by o.criado_em desc
    limit 1
  ) prop on true
  order by
    coalesce(sel.selecionado,false) desc,
    msg.ultima_em desc nulls last,
    p.nome;
$function$;

CREATE OR REPLACE FUNCTION public.qf_confirmar_profissional(p_chamado_id uuid, p_profissional_id uuid, p_endereco jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cliente uuid := auth.uid();
  v_status text;
  v_orc uuid;
  v_rua text := trim(coalesce(p_endereco->>'rua',''));
  v_numero text := trim(coalesce(p_endereco->>'numero',''));
  v_bairro text := trim(coalesce(p_endereco->>'bairro',''));
  v_cidade text := trim(coalesce(p_endereco->>'cidade',''));
  v_uf text := upper(trim(coalesce(p_endereco->>'uf','')));
  v_cep text := regexp_replace(coalesce(p_endereco->>'cep',''),'\D','','g');
  v_comp text := trim(coalesce(p_endereco->>'complemento',''));
  v_lat numeric;
  v_lng numeric;
begin
  if v_cliente is null then raise exception 'authentication required'; end if;

  select c.status into v_status
  from public.qf_chamados c
  where c.id=p_chamado_id and c.cliente_id=v_cliente
  for update;

  if v_status is null then raise exception 'call not found'; end if;
  if v_status not in ('aberto','em_negociacao') then
    return jsonb_build_object('ok',false,'reason','chamado_encerrado','status',v_status);
  end if;

  if not exists(
    select 1 from public.qf_desbloqueios d
    where d.chamado_id=p_chamado_id
      and d.profissional_id=p_profissional_id
      and coalesce(d.ativo,true)
  ) then
    return jsonb_build_object('ok',false,'reason','profissional_indisponivel');
  end if;

  if v_rua='' or v_numero='' or v_bairro='' or v_cidade='' or char_length(v_uf)<>2 then
    return jsonb_build_object('ok',false,'reason','endereco_incompleto');
  end if;

  begin v_lat:=nullif(p_endereco->>'latitude','')::numeric; exception when others then v_lat:=null; end;
  begin v_lng:=nullif(p_endereco->>'longitude','')::numeric; exception when others then v_lng:=null; end;

  -- Primeiro registra quem foi escolhido. Assim os gatilhos de mudança de status
  -- já enxergam o profissional correto.
  select o.id into v_orc
  from public.qf_orcamentos o
  where o.chamado_id=p_chamado_id
    and o.profissional_id=p_profissional_id
    and o.status='enviado'
  order by o.criado_em desc
  limit 1
  for update;

  if v_orc is null then
    insert into public.qf_orcamentos(
      chamado_id,profissional_id,valor_centavos,descricao,status,
      mao_obra_centavos,material_centavos,taxa_visita_centavos
    )
    values(
      p_chamado_id,p_profissional_id,0,'Acordo combinado pelo chat','aceito',0,0,0
    )
    returning id into v_orc;
  else
    update public.qf_orcamentos
       set status='aceito',motivo_recusa=null,atualizado_em=now()
     where id=v_orc;
  end if;

  update public.qf_orcamentos
     set status='nao_selecionado',
         motivo_recusa='Cliente escolheu outro profissional.',
         atualizado_em=now()
   where chamado_id=p_chamado_id
     and profissional_id<>p_profissional_id
     and status='enviado';

  update public.qf_chamados
     set endereco_completo=v_rua||', '||v_numero||
          case when v_comp<>'' then ' · '||v_comp else '' end,
         bairro=v_bairro,
         cidade=v_cidade,
         uf=v_uf,
         cep=case when char_length(v_cep)=8 then v_cep else cep end,
         latitude=coalesce(v_lat,latitude),
         longitude=coalesce(v_lng,longitude),
         status='confirmado',
         atualizado_em=now()
   where id=p_chamado_id and cliente_id=v_cliente;

  insert into public.qf_chat_mensagens(
    chamado_id,profissional_id,remetente_id,mensagem,tipo
  )
  values(
    p_chamado_id,p_profissional_id,v_cliente,
    'Serviço confirmado. O endereço e o contato foram liberados para o profissional.',
    'sistema'
  );

  perform private.qf_push_interno('professional_selected',p_chamado_id);

  return jsonb_build_object(
    'ok',true,'status','confirmado','chamado_id',p_chamado_id,
    'profissional_id',p_profissional_id,'orcamento_id',v_orc
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_contagem_participantes(p_chamado_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when exists(
      select 1 from public.qf_chamados c
      where c.id=p_chamado_id and c.cliente_id=auth.uid()
    ) or exists(
      select 1 from public.qf_desbloqueios d
      where d.chamado_id=p_chamado_id
        and d.profissional_id=auth.uid()
        and coalesce(d.ativo,true)
    )
    then jsonb_build_object(
      'ok',true,
      'participantes',(
        select count(*) from public.qf_desbloqueios x
        where x.chamado_id=p_chamado_id and coalesce(x.ativo,true)
      ),
      'limite',5
    )
    else jsonb_build_object('ok',false,'reason','forbidden')
  end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_disparar_push_novo_chamado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status='aberto'
     and (new.data_preferida is null or new.data_preferida <= now()+interval '24 hours') then
    insert into public.qf_chamado_alertas(chamado_id,tipo)
    values(new.id,'programado_24h')
    on conflict do nothing;
    perform private.qf_push_interno('new_call',new.id);
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz push trigger: %',sqlerrm;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_enviar_mensagem_chat(p_chamado_id uuid, p_profissional_id uuid, p_mensagem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_cliente uuid;
  v_prof uuid;
  v_status text;
  v_msg text := trim(coalesce(p_mensagem,''));
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if char_length(v_msg)<1 or char_length(v_msg)>1500 then
    return jsonb_build_object('ok',false,'reason','mensagem_invalida');
  end if;

  select c.cliente_id,c.status into v_cliente,v_status
  from public.qf_chamados c
  where c.id=p_chamado_id
  for update;

  if v_cliente is null then raise exception 'call not found'; end if;

  if v_user=v_cliente then
    v_prof := p_profissional_id;
    if v_prof is null then return jsonb_build_object('ok',false,'reason','profissional_obrigatorio'); end if;
  else
    v_prof := v_user;
    if p_profissional_id is not null and p_profissional_id<>v_user then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
  end if;

  if not exists(
    select 1 from public.qf_desbloqueios d
    where d.chamado_id=p_chamado_id
      and d.profissional_id=v_prof
      and coalesce(d.ativo,true)
  ) then
    return jsonb_build_object('ok',false,'reason','conversa_indisponivel');
  end if;

  if v_status in ('cancelado','expirado','finalizado') then
    return jsonb_build_object('ok',false,'reason','chamado_encerrado');
  end if;

  if v_status in ('confirmado','em_andamento','concluido') and not exists(
    select 1 from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id
      and o.profissional_id=v_prof
      and o.status='aceito'
  ) then
    return jsonb_build_object('ok',false,'reason','nao_selecionado');
  end if;

  insert into public.qf_chat_mensagens(
    chamado_id,profissional_id,remetente_id,mensagem,tipo
  )
  values(p_chamado_id,v_prof,v_user,v_msg,'mensagem')
  returning id into v_id;

  perform private.qf_push_interno('chat_message',p_chamado_id);

  return jsonb_build_object(
    'ok',true,'id',v_id,'chamado_id',p_chamado_id,
    'profissional_id',v_prof,'criado_em',now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_pedir_devolucao_lead(p_chamado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prof uuid := auth.uid();
  d public.qf_desbloqueios;
  v_status text;
  v_cliente uuid;
  v_usados int;
  v_valor int;
  v_novo_status text;
begin
  if v_prof is null then raise exception 'authentication required'; end if;

  select * into d
  from public.qf_desbloqueios
  where chamado_id=p_chamado_id and profissional_id=v_prof
  for update;

  if d.id is null then return jsonb_build_object('ok',false,'reason','sem_desbloqueio'); end if;
  if exists (select 1 from public.qf_devolucoes_lead where desbloqueio_id=d.id) then
    return jsonb_build_object('ok',false,'reason','ja_devolvido');
  end if;
  if not d.ativo then return jsonb_build_object('ok',false,'reason','sem_desbloqueio'); end if;
  if not (d.origem='plano' or (d.origem='saldo' and coalesce(d.valor_centavos,0)>0)) then
    return jsonb_build_object('ok',false,'reason','sem_cobranca');
  end if;
  if d.criado_em > now()-interval '24 hours' then
    return jsonb_build_object('ok',false,'reason','aguarde_24h','liberado_em',d.criado_em+interval '24 hours');
  end if;

  select status,cliente_id into v_status,v_cliente
  from public.qf_chamados
  where id=p_chamado_id
  for update;

  if v_status <> 'em_negociacao' then
    return jsonb_build_object('ok',false,'reason','status_invalido','status',v_status);
  end if;

  if exists (
    select 1 from public.qf_chat_mensagens m
    where m.chamado_id=p_chamado_id
      and m.profissional_id=v_prof
      and m.remetente_id=v_cliente
      and m.criado_em>=d.criado_em
  ) or exists (
    select 1 from public.qf_orcamentos o
    where o.chamado_id=p_chamado_id
      and o.profissional_id=v_prof
      and o.status in ('aceito','recusado','nao_selecionado')
  ) then
    return jsonb_build_object('ok',false,'reason','cliente_respondeu');
  end if;

  select count(*) into v_usados
  from public.qf_devolucoes_lead
  where profissional_id=v_prof
    and motivo='cliente_nao_respondeu'
    and criado_em>now()-interval '30 days';

  if v_usados>=2 then
    return jsonb_build_object('ok',false,'reason','limite_mensal','limite',2);
  end if;

  v_valor := qf_private.devolver_lead(d.id,'cliente_nao_respondeu');
  if v_valor<=0 then return jsonb_build_object('ok',false,'reason','sem_cobranca'); end if;

  update public.qf_orcamentos
     set status='cancelado',
         motivo_recusa='Sem resposta do cliente (lead devolvido)',
         atualizado_em=now()
   where chamado_id=p_chamado_id
     and profissional_id=v_prof
     and status='enviado';

  select case when exists (
    select 1 from public.qf_desbloqueios dx
    where dx.chamado_id=p_chamado_id
      and dx.profissional_id<>v_prof
      and coalesce(dx.ativo,true)
  ) then 'em_negociacao' else 'aberto' end
  into v_novo_status;

  update public.qf_chamados
     set status=v_novo_status,atualizado_em=now()
   where id=p_chamado_id and status='em_negociacao';

  return jsonb_build_object(
    'ok',true,
    'valor_centavos',case when d.origem='plano' then 0 else v_valor end,
    'origem',d.origem,
    'usados_30d',v_usados+1,
    'limite',2,
    'status',v_novo_status
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_portfolio_servicos()
 RETURNS TABLE(id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text, endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone, prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric, raio_atual_km integer, preco_centavos integer, tempo_min integer, participantes integer, limite integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    d.id,d.categoria,d.titulo,d.descricao,d.cidade,d.uf,d.bairro,d.endereco_completo,
    d.latitude,d.longitude,d.data_preferida,d.prioridade,d.criado_em,d.status,
    d.distancia_km,d.raio_atual_km,d.preco_centavos,d.tempo_min,
    (
      select count(*)::integer
      from public.qf_desbloqueios x
      where x.chamado_id=d.id and coalesce(x.ativo,true)
    ) as participantes,
    5::integer as limite
  from public.qf_listar_chamados_disponiveis() d
  order by
    case
      when d.data_preferida is null then 0
      when d.data_preferida <= now() + interval '24 hours' then 0
      else 1
    end,
    d.data_preferida asc nulls first,
    d.prioridade desc,
    d.distancia_km asc nulls last,
    d.criado_em desc;
$function$;


-- RPCs do novo fluxo são somente para usuário autenticado.
revoke execute on function public.qf_portfolio_servicos() from public, anon;
revoke execute on function public.qf_cliente_conversas(uuid) from public, anon;
revoke execute on function public.qf_chat_conversa(uuid,uuid) from public, anon;
revoke execute on function public.qf_enviar_mensagem_chat(uuid,uuid,text) from public, anon;
revoke execute on function public.qf_confirmar_profissional(uuid,uuid,jsonb) from public, anon;
revoke execute on function public.qf_contagem_participantes(uuid) from public, anon;

grant execute on function public.qf_portfolio_servicos() to authenticated;
grant execute on function public.qf_cliente_conversas(uuid) to authenticated;
grant execute on function public.qf_chat_conversa(uuid,uuid) to authenticated;
grant execute on function public.qf_enviar_mensagem_chat(uuid,uuid,text) to authenticated;
grant execute on function public.qf_confirmar_profissional(uuid,uuid,jsonb) to authenticated;
grant execute on function public.qf_contagem_participantes(uuid) to authenticated;

-- Mantém um único verificador para liberar o alerta quando entra na janela de 24h.
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='qf_programados_24h' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'qf_programados_24h',
    '* * * * *',
    'select private.qf_alertar_programados_24h();'
  );
end $$;
