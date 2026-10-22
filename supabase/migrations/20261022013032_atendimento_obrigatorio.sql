-- Staging only. Do not apply to production before the release checks in docs/atendimento.md.
begin;
create table private.qf_atendimentos (
  chave uuid primary key,
  cliente_id uuid not null,
  chamado_id uuid not null unique,
  respostas jsonb not null,
  fingerprint text not null,
  criado_em timestamptz not null default now()
);
alter table private.qf_atendimentos enable row level security;
revoke all on private.qf_atendimentos from public, anon, authenticated;
create index qf_atendimentos_fingerprint on private.qf_atendimentos(fingerprint, criado_em desc);
alter table public.qf_chamados add column atendimento_id uuid references private.qf_atendimentos(chave);
alter table public.qf_chamados add column atendimento_tipo text check(atendimento_tipo in ('tradicional','garante'));
create index qf_chamados_atendimento_id_idx on public.qf_chamados(atendimento_id) where atendimento_id is not null;
-- Existing rows remain NULL; status/payment/admin updates continue unchanged.
create function private.qf_atendimento_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    -- Release preparation only: legacy API remains available until the verified frontend is live.
    -- Missing configuration means mandatory enforcement; normal operation always keeps this true.
    if new.atendimento_id is null and not coalesce((select (valor->>'ativo')::boolean from public.qf_config where chave='atendimento_obrigatorio'),true) then return new; end if;
    if new.atendimento_id is null or not exists (
      select 1 from private.qf_atendimentos a where a.chave=new.atendimento_id
      and a.chamado_id=new.id and a.cliente_id=new.cliente_id
      and a.respostas->>'tipo'=new.atendimento_tipo
    ) then raise exception 'atendimento_obrigatorio: atualize o aplicativo e conclua o atendimento'; end if;
  elsif new.atendimento_id is distinct from old.atendimento_id or new.atendimento_tipo is distinct from old.atendimento_tipo then
    raise exception 'atendimento_imutavel';
  end if;
  if new.atendimento_tipo='garante' then new.max_orcamentos:=1; end if;
  if new.atendimento_tipo='tradicional' then new.max_orcamentos:=4; end if;
  return new;
end $$;
revoke all on function private.qf_atendimento_guard() from public,anon,authenticated;
create trigger qf_zz_atendimento_guard before insert or update on public.qf_chamados
for each row execute function private.qf_atendimento_guard();

create function private.qf_atendimento_apagar_contato() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.qf_atendimentos set respostas='{}'::jsonb where cliente_id=old.id;
  return old;
end $$;
revoke all on function private.qf_atendimento_apagar_contato() from public,anon,authenticated;
create trigger qf_atendimento_apagar_contato after delete on public.qf_profiles
for each row execute function private.qf_atendimento_apagar_contato();

-- The only new public submission entry point. No supplied client_id, status, price,
-- coordinates, timestamps or max_orcamentos is trusted. Existing INSERT triggers run once.
create function public.qf_publicar_atendimento(p_respostas jsonb, p_geo jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  u uuid:=auth.uid(); k uuid; cid uuid:=gen_random_uuid(); a jsonb:=p_respostas;
  r private.qf_atendimentos; result public.qf_chamados; fp text; f text; b integer; dt date;
  tel text; profile_tel text; descricao_segura text; lat numeric; lng numeric;
begin
  if u is null or not exists(select 1 from public.qf_profiles p where p.id=u and p.tipo='cliente' and coalesce(p.ativo,true)) then raise exception 'cliente_autenticado_obrigatorio'; end if;
  if jsonb_typeof(a) is distinct from 'object' or octet_length(a::text)>20000 or a->>'versao' is distinct from '1' then raise exception 'atendimento_invalido'; end if;
  foreach f in array array['chave','categoria','servico','detalhes','escopo','cidade','uf','bairro','urgencia','materiais','data','disponibilidade','nome','contato','intencao','autorizacao','tipo'] loop
    if nullif(btrim(a->>f),'') is null or length(a->>f)>2000 then raise exception 'resposta_obrigatoria: %',f; end if;
  end loop;
  if length(a->>'detalhes')<8 or length(a->>'escopo')<3 or length(a->>'disponibilidade')<3 or length(a->>'nome')<2
    or a->>'uf' !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'
    or a->>'tipo' not in ('tradicional','garante')
    or a->>'intencao' not in ('contratar','pesquisando')
    or a->>'urgencia' not in ('normal','urgente')
    or a->>'materiais' not in ('profissional','cliente','combinar','nao_aplica')
    or a->>'autorizacao' is distinct from 'sim' then raise exception 'respostas_invalidas_ou_sem_autorizacao'; end if;
  -- Never publish contact/address-like content embedded in public free text.
  foreach f in array array['servico','categoria','detalhes','escopo','cidade','bairro','disponibilidade'] loop
    if (a->>f) ~* '([0-9][ .()+-]*){7,}|@|https?://|www\.|\m(rua|avenida|travessa|alameda)\M' then
      raise exception 'dados_pessoais_no_campo: %. Remova contato e endereço exato.',f;
    end if;
  end loop;
  tel:=regexp_replace(a->>'contato','[^0-9]','','g');
  if tel !~ '^[1-9][0-9]9?[0-9]{8}$' then raise exception 'contato_invalido'; end if;
  select regexp_replace(coalesce(nullif(p.whatsapp,''),p.telefone,''),'[^0-9]','','g') into profile_tel from public.qf_profiles p where p.id=u;
  if profile_tel='55'||tel then profile_tel:=tel; end if;
  if tel is distinct from profile_tel then raise exception 'Use o celular cadastrado na sua conta ou atualize seu perfil antes de publicar.'; end if;
  k:=(a->>'chave')::uuid;
  if not (a ? 'orcamento_centavos') then raise exception 'orcamento_obrigatorio'; end if;
  b:=(a->>'orcamento_centavos')::integer;
  if b is not null and (b<100 or b>50000000) then raise exception 'orcamento_invalido'; end if;
  dt:=(a->>'data')::date;
  if dt<(now() at time zone 'America/Sao_Paulo')::date then raise exception 'data_passada'; end if;
  if a->>'tipo'='garante' and (a->>'intencao'<>'contratar' or b is null or a->>'materiais'='combinar' or a->>'qualificacao' is distinct from 'sim') then raise exception 'garante_nao_qualificado'; end if;
  -- Lock key and semantic fingerprint: retries and concurrent submits have one winner.
  -- Contact is hashed inside a private table; different quick-access accounts cannot spam the same order.
  fp:=md5(lower(regexp_replace(concat_ws('|',tel,btrim(a->>'categoria'),btrim(a->>'detalhes'),btrim(a->>'escopo'),btrim(a->>'cidade'),a->>'uf',btrim(a->>'bairro'),dt::text),'\s+',' ','g')));
  perform pg_advisory_xact_lock(hashtextextended(k::text,0));
  perform pg_advisory_xact_lock(hashtextextended(fp,1));
  select * into r from private.qf_atendimentos where chave=k;
  if found then
    if r.cliente_id<>u or r.respostas<>a then raise exception 'chave_reutilizada_com_outros_dados'; end if;
    select * into result from public.qf_chamados where id=r.chamado_id and cliente_id=u;
    if not found then raise exception 'pedido_removido'; end if;
    return to_jsonb(result);
  end if;
  select * into r from private.qf_atendimentos where fingerprint=fp and criado_em>now()-interval '24 hours' order by criado_em desc limit 1;
  if found then
    if r.cliente_id<>u then raise exception 'pedido_duplicado: já existe um pedido equivalente para este contato'; end if;
    if (r.respostas - 'chave') is distinct from (a - 'chave') then raise exception 'pedido_duplicado_com_outros_dados: já existe pedido equivalente. Revise o pedido existente antes de alterar modalidade ou condições.'; end if;
    select * into result from public.qf_chamados where id=r.chamado_id and cliente_id=u;
    if found then return to_jsonb(result); end if;
    raise exception 'pedido_duplicado_removido';
  end if;
  -- Geo is only approximate: the frontend resolves city/bairro using the current integration.
  lat:=(p_geo->>'latitude')::numeric; lng:=(p_geo->>'longitude')::numeric;
  if lat is not null and lng is not null and abs(lat)<=90 and abs(lng)<=180 then
    lat:=round(lat,2);lng:=round(lng,2);
  else lat:=null;lng:=null; end if;
  -- Keep routing functional when the browser geocoder is unavailable: use the existing city reference.
  if lat is null or lng is null then
    select round(gc.latitude,2),round(gc.longitude,2) into lat,lng
    from public.qf_cidades_coord gc
    where private.qf_norm_txt(gc.cidade)=private.qf_norm_txt(a->>'cidade') and gc.uf=a->>'uf'
      and gc.latitude between -90 and 90 and gc.longitude between -180 and 180
      and not (gc.latitude=0 and gc.longitude=0)
    limit 1;
  end if;
  if lat is null or lng is null then raise exception 'localizacao_indisponivel: Não foi possível localizar sua cidade agora. Suas respostas continuam aqui; tente novamente.'; end if;
  insert into private.qf_atendimentos(chave,cliente_id,chamado_id,respostas,fingerprint) values(k,u,cid,a,fp);
  descricao_segura:=concat_ws(E'\n',a->>'detalhes','Escopo: '||(a->>'escopo'),'Materiais: '||(a->>'materiais'),'Disponibilidade: '||(a->>'disponibilidade'));
  descricao_segura:=replace(descricao_segura,a->>'nome','[nome protegido]');
  insert into public.qf_chamados(id,cliente_id,categoria,titulo,descricao,cidade,uf,bairro,latitude,longitude,geo_precisao,marketing_origem,
    data_preferida,status,prioridade,urgencia,max_orcamentos,orcamento_aproximado_centavos,interesse_cliente,atendimento_id,atendimento_tipo)
  values(cid,u,a->>'categoria',replace(a->>'servico',a->>'nome','[nome protegido]'),descricao_segura,a->>'cidade',a->>'uf',a->>'bairro',lat,lng,case when p_geo->>'geo_precisao' in ('bairro','cidade','cep','gps') then p_geo->>'geo_precisao' else 'cidade' end,case when jsonb_typeof(p_geo->'marketing_origem')='object' and octet_length((p_geo->'marketing_origem')::text)<4000 then p_geo->'marketing_origem' else '{}'::jsonb end,
    ((dt::text||' 12:00:00')::timestamp at time zone 'America/Sao_Paulo'),'aberto',false,a->>'urgencia',case when a->>'tipo'='garante' then 1 else 4 end,b,a->>'intencao',k,a->>'tipo')
  returning * into result;
  return to_jsonb(result);
end $$;
revoke all on function public.qf_publicar_atendimento(jsonb,jsonb) from public,anon;
grant execute on function public.qf_publicar_atendimento(jsonb,jsonb) to authenticated;

-- Metadata without PII. Accessible only to owner/admin or professionals who can see/unlocked the call.
create function public.qf_atendimento_info(p_ids uuid[]) returns table(chamado_id uuid,tipo text)
language sql stable security definer set search_path='' as $$
 select c.id,c.atendimento_tipo from public.qf_chamados c
 where c.id=any(p_ids[1:500]) and c.atendimento_tipo is not null and auth.uid() is not null
 and (c.cliente_id=auth.uid() or private.qf_is_admin() or exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=auth.uid() and coalesce(d.ativo,true))
 or exists(select 1 from public.qf_listar_chamados_disponiveis() d where d.id=c.id))
$$;
revoke all on function public.qf_atendimento_info(uuid[]) from public,anon;
grant execute on function public.qf_atendimento_info(uuid[]) to authenticated;

-- Full answers: only owner/admin or the professional with an active paid unlock.
create function public.qf_atendimento_respostas(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select (a.respostas - 'chave') || jsonb_build_object('registrado_em',a.criado_em) from private.qf_atendimentos a where a.chamado_id=p_id and auth.uid() is not null
 and (a.cliente_id=auth.uid() or private.qf_is_admin() or exists(select 1 from public.qf_desbloqueios d where d.chamado_id=a.chamado_id and d.profissional_id=auth.uid() and coalesce(d.ativo,true)))
$$;
revoke all on function public.qf_atendimento_respostas(uuid) from public,anon;
grant execute on function public.qf_atendimento_respostas(uuid) to authenticated;

-- Existing transactional unlock, with Garante checks under the same row lock.
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

REVOKE ALL ON FUNCTION public.qf_desbloquear_chamado(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qf_desbloquear_chamado(uuid, boolean) TO authenticated;
commit;
