
create table if not exists private.qf_reativacao_20261022_pedidos (
 chamado_id uuid primary key references public.qf_chamados(id), categoria text not null, criado_em timestamptz not null default now()
);
create table if not exists private.qf_reativacao_20261022_profissionais (
 profissional_id uuid primary key references public.qf_profissionais(user_id), criado_em timestamptz not null default now(),
 usado_em timestamptz, chamado_usado uuid references public.qf_chamados(id)
);
alter table private.qf_reativacao_20261022_pedidos enable row level security;
alter table private.qf_reativacao_20261022_profissionais enable row level security;
revoke all on private.qf_reativacao_20261022_pedidos,private.qf_reativacao_20261022_profissionais from public,anon,authenticated;
create or replace function private.qf_cortesia_reativacao_20261022(p_chamado_id uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and exists (
 select 1 from private.qf_reativacao_20261022_profissionais b
 join public.qf_profissionais pr on pr.user_id=b.profissional_id
 join private.qf_reativacao_20261022_pedidos cp on cp.chamado_id=p_chamado_id
 join public.qf_chamados c on c.id=cp.chamado_id
 where b.profissional_id=auth.uid() and b.usado_em is null
 and c.categoria=cp.categoria and c.categoria=any(pr.especialidades)
 and c.atendimento_tipo is distinct from 'garante'
 and c.status in ('aberto','em_negociacao') and not private.qf_pedido_expiravel_72h(c)
 );
$fn$;
revoke all on function private.qf_cortesia_reativacao_20261022(uuid) from public,anon,authenticated;

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
  v_garante boolean;
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

  perform 1 from public.qf_chamados c where c.id=p_chamado_id for update;

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

  select c.atendimento_tipo='garante' into v_garante from public.qf_chamados c where c.id=p_chamado_id;
  if coalesce(v_garante,false) then
    if not v_exclusivo then return jsonb_build_object('ok',false,'reason','garante_exige_exclusivo'); end if;
    if not exists(select 1 from public.qf_profissionais pr where pr.user_id=v_prof and pr.verificado is true
      and nullif(btrim(pr.documento),'') is not null) then
      return jsonb_build_object('ok',false,'reason','garante_exige_verificacao');
    end if;
    -- Once contact was released it can never be sold to a second professional, even after a refund.
    if exists(select 1 from public.qf_desbloqueios d where d.chamado_id=p_chamado_id) then
      return jsonb_build_object('ok',false,'reason','reservado');
    end if;
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
  if coalesce(v_garante,false) then
    v_preco := v_preco_tabela * 4;
  elsif v_exclusivo then
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

  -- One courtesy per existing professional, restricted to the frozen request snapshot.
  if not v_exclusivo and private.qf_cortesia_reativacao_20261022(p_chamado_id) then
    update private.qf_reativacao_20261022_profissionais
      set usado_em=now(),chamado_usado=p_chamado_id
      where profissional_id=v_prof and usado_em is null;
    if found then
      insert into public.qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem,ativo,exclusivo)
        values(p_chamado_id,v_prof,0,'cortesia_admin',true,false);
      update public.qf_chamados set status='em_negociacao',atualizado_em=now() where id=p_chamado_id;
      perform private.qf_push_interno('professional_connected',p_chamado_id);
      return jsonb_build_object('ok',true,'origem','cortesia_admin','usou_bonus',true,'exclusivo',false,
        'preco_centavos',0,'preco_tabela_centavos',v_preco_tabela,
        'participantes',(select count(*)::integer from public.qf_desbloqueios x where x.chamado_id=p_chamado_id and coalesce(x.ativo,true)),
        'limite',public.qf_limite_orcamentos(p_chamado_id));
    end if;
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

CREATE OR REPLACE FUNCTION public.qf_listar_chamados_disponiveis()
 RETURNS TABLE(id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text, endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone, prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric, raio_atual_km integer, preco_centavos integer, tempo_min integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with profissional as (
 select pr.user_id,pr.especialidades,pr.online,pr.latitude pro_latitude,pr.longitude pro_longitude,
 coalesce(pr.raio_km,20)::integer raio_configurado_km
 from public.qf_profissionais pr
 where pr.user_id=auth.uid() and pr.online is true
 and exists(select 1 from public.qf_profiles pf where pf.id=pr.user_id and coalesce(pf.ativo,true))
 and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
)
select c.id,c.categoria,c.titulo,public.qf_ocultar_contato(c.descricao),c.cidade,c.uf,c.bairro,null::text,
round(g.latitude,2),round(g.longitude,2),c.data_preferida,c.prioridade,c.criado_em,'aberto'::text,
case when public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude) is null then null else round(public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude),1) end,
p.raio_configurado_km,(case when private.qf_cortesia_reativacao_20261022(c.id) then 0 else coalesce(pd.preco_centavos,padrao.preco_centavos,790) end)::integer,
public.qf_tempo_estimado_min(public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude))
from public.qf_chamados c cross join profissional p
left join lateral private.qf_chamado_centro(c.id) g on true
left join public.qf_precos_desbloqueio pd on pd.categoria=c.categoria and pd.ativo
left join public.qf_precos_desbloqueio padrao on padrao.categoria='padrao'
where c.status in ('aberto','em_negociacao') and not private.qf_pedido_expiravel_72h(c)
and c.categoria = any(coalesce(p.especialidades,array[]::text[]))
and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id=c.id and coalesce(dx.ativo,true)) < public.qf_limite_orcamentos(c.id)
and (c.cliente_id is distinct from p.user_id and private.qf_pro_recebe_chamado(p.user_id,c.id))
and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=p.user_id)
order by c.prioridade desc,public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude) asc nulls last,c.criado_em desc
$function$;


create or replace function public.qf_usar_cortesia_reativacao(p_chamado_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 -- Same lock order as the regular unlock avoids deadlocks.
 perform 1 from public.qf_chamados where id=p_chamado_id for update;
 perform 1 from private.qf_reativacao_20261022_profissionais where profissional_id=auth.uid() for update;
 if not private.qf_cortesia_reativacao_20261022(p_chamado_id) then
   return jsonb_build_object('ok',false,'reason','cortesia_indisponivel');
 end if;
 return public.qf_desbloquear_chamado(p_chamado_id,false);
end $fn$;
revoke all on function public.qf_usar_cortesia_reativacao(uuid) from public,anon;
grant execute on function public.qf_usar_cortesia_reativacao(uuid) to authenticated;

-- Snapshot inicial: executado uma unica vez em 22/10/2026.

select pg_advisory_xact_lock(hashtext('qf_reativacao_20261022'));
insert into private.qf_reativacao_20261022_pedidos(chamado_id,categoria)
select c.id,c.categoria from public.qf_chamados c
where c.status='aberto' and c.atendimento_tipo is distinct from 'garante'
and not private.qf_pedido_expiravel_72h(c)
and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id)
and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
and not exists(select 1 from private.qf_reativacao_20261022_pedidos);
insert into private.qf_reativacao_20261022_profissionais(profissional_id)
select distinct pr.user_id from public.qf_profissionais pr join public.qf_profiles pf on pf.id=pr.user_id
where coalesce(pf.ativo,true) and pr.criado_em<=(select min(criado_em) from private.qf_reativacao_20261022_pedidos)
and exists(select 1 from private.qf_reativacao_20261022_pedidos cp where cp.categoria=any(pr.especialidades))
and not exists(select 1 from private.qf_reativacao_20261022_profissionais);
select (select count(*) from private.qf_reativacao_20261022_pedidos) pedidos,
(select count(*) from private.qf_reativacao_20261022_profissionais) profissionais;

-- Testes sem consumo permanente:

begin;
do $test$
declare
 v_uid uuid := '0837a36f-3641-44b1-95b4-8e68fbf1f6cc';
 v_call uuid; v_result jsonb; v_wallet jsonb; v_plans jsonb;
begin
 perform set_config('request.jwt.claim.sub',v_uid::text,true);
 select id into v_call from public.qf_listar_chamados_disponiveis() where preco_centavos=0 limit 1;
 if v_call is null then raise exception 'No courtesy request visible'; end if;
 select to_jsonb(w) into v_wallet from public.qf_carteiras w where profissional_id=v_uid;
 select jsonb_agg(to_jsonb(p)) into v_plans from public.qf_planos_profissional p where profissional_id=v_uid;
 v_result:=public.qf_usar_cortesia_reativacao(v_call);
 if v_result->>'origem'<>'cortesia_admin' or (v_result->>'preco_centavos')::integer<>0 or not (v_result->>'ok')::boolean then raise exception 'Courtesy failed: %',v_result; end if;
 if v_wallet is distinct from (select to_jsonb(w) from public.qf_carteiras w where profissional_id=v_uid) then raise exception 'Wallet changed'; end if;
 if v_plans is distinct from (select jsonb_agg(to_jsonb(p)) from public.qf_planos_profissional p where profissional_id=v_uid) then raise exception 'Plan changed'; end if;
 if exists(select 1 from public.qf_listar_chamados_disponiveis() where preco_centavos=0) then raise exception 'Second free unlock available'; end if;
 v_result:=public.qf_usar_cortesia_reativacao(v_call);
 if v_result->>'reason'<>'cortesia_indisponivel' then raise exception 'Stale courtesy guard failed'; end if;
 v_result:=public.qf_desbloquear_chamado(v_call,false);
 if not coalesce((v_result->>'already_unlocked')::boolean,false) then raise exception 'Idempotency failed'; end if;
 if (select count(*) from public.qf_desbloqueios where profissional_id=v_uid and chamado_id=v_call)<>1 then raise exception 'Duplicate unlock'; end if;
 if not exists(select 1 from private.qf_reativacao_20261022_profissionais where profissional_id=v_uid and usado_em is not null and chamado_usado=v_call) then raise exception 'Token not consumed'; end if;
 if exists(select 1 from public.qf_chamados c where not exists(select 1 from private.qf_reativacao_20261022_pedidos cp where cp.chamado_id=c.id) and private.qf_cortesia_reativacao_20261022(c.id)) then raise exception 'New request got courtesy'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 if private.qf_cortesia_reativacao_20261022(v_call) then raise exception 'New user got courtesy'; end if;
end $test$;
rollback;
select 'PASS: zero charge, unchanged wallet/plan, single use, idempotency, snapshot-only, rollback' test;

-- Avisos idempotentes:

alter table private.qf_reativacao_20261022_profissionais add column if not exists aviso_id uuid, add column if not exists push_request_id bigint, add column if not exists avisado_em timestamptz;
do $notify$
declare b record; v_aviso uuid; v_req bigint; v_secret text;
v_title text:='Você ganhou um desbloqueio grátis';
v_body text:='Use 1 desbloqueio grátis em um dos pedidos participantes da sua profissão. Cortesia nos pedidos já publicados, conforme região e vagas. Abra o app e confira. Não garante contratação.';
begin
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='qf_push_internal' limit 1;
 if length(coalesce(v_secret,''))<32 then raise exception 'Push internal not configured'; end if;
 for b in select profissional_id from private.qf_reativacao_20261022_profissionais where avisado_em is null for update loop
 insert into public.qf_profissional_avisos(user_id,chamado_id,tipo,titulo,corpo,rota)
 values(b.profissional_id,(select cp.chamado_id from private.qf_reativacao_20261022_pedidos cp join public.qf_profissionais pr on pr.user_id=b.profissional_id and cp.categoria=any(pr.especialidades) order by private.qf_pro_recebe_chamado(b.profissional_id,cp.chamado_id) desc,cp.criado_em limit 1),'cortesia_reativacao_20261022',v_title,v_body,'/profissional/home') returning id into v_aviso;
 select net.http_post(
 url:='https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
 headers:=jsonb_build_object('Content-Type','application/json','x-qf-internal',v_secret),
 body:=jsonb_build_object('action','user_notice','user_ids',jsonb_build_array(b.profissional_id),
 'title',v_title,'body',v_body,'url','/#/profissional/home','tag','qf-cortesia-20261022'),
 timeout_milliseconds:=60000) into v_req;
 update private.qf_reativacao_20261022_profissionais set aviso_id=v_aviso,push_request_id=v_req,avisado_em=now() where profissional_id=b.profissional_id;
 end loop;
end $notify$;
select count(*) profissionais,count(*) filter(where aviso_id is not null) avisos_no_app,count(*) filter(where push_request_id is not null) pushes_enfileirados from private.qf_reativacao_20261022_profissionais;
