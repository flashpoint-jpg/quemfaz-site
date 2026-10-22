CREATE OR REPLACE FUNCTION private.qf_dentro_horario(p_inicio time without time zone, p_fim time without time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_inicio is null or p_fim is null or p_inicio = p_fim then true
    when p_inicio < p_fim then (now() at time zone 'America/Sao_Paulo')::time >= p_inicio
                           and (now() at time zone 'America/Sao_Paulo')::time <  p_fim
    else (now() at time zone 'America/Sao_Paulo')::time >= p_inicio
      or (now() at time zone 'America/Sao_Paulo')::time <  p_fim
  end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_push_reservar_entregas(p_chamado_id uuid, p_user_ids uuid[], p_evento text, p_raio_etapa_km integer)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_ids uuid[]; v_etapa smallint; v_rodada integer;
begin
  if not exists(select 1 from public.qf_chamados c where c.id=p_chamado_id and c.status in ('aberto','em_negociacao'))
    or exists(select 1 from public.qf_orcamentos o where o.chamado_id=p_chamado_id and o.status='aceito')
    or (select count(*) from public.qf_desbloqueios d where d.chamado_id=p_chamado_id and coalesce(d.ativo,true)) >= public.qf_limite_orcamentos(p_chamado_id)
  then return array[]::uuid[]; end if;
  select etapa,rodada into v_etapa,v_rodada from public.qf_chamado_cascata where chamado_id=p_chamado_id;
  with reserved as (
    insert into public.qf_push_entregas as e(chamado_id,user_id,evento,raio_etapa_km,cascata_etapa,rodada,envio_status,tentativas,tentativa_em)
    select p_chamado_id,u,p_evento,p_raio_etapa_km,coalesce(v_etapa,1),coalesce(v_rodada,1),'processando',1,now()
    from (select distinct unnest(coalesce(p_user_ids,array[]::uuid[])) u) ids
    where not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=p_chamado_id and d.profissional_id=u)
    on conflict(chamado_id,user_id,evento,rodada) do update
    set envio_status='processando',tentativas=e.tentativas+1,tentativa_em=now(),envio_erro=null,
      com_push=exists(select 1 from public.qf_push_subscriptions s where s.user_id=e.user_id and s.ativo)
    where e.tentativas<3 and (
      (e.envio_status in ('falhou','sem_inscricao','fora_horario','reenvio_solicitado') and e.tentativa_em < now()-interval '5 minutes')
      or (e.envio_status='processando' and e.tentativa_em < now()-interval '10 minutes')
    ) and exists(select 1 from public.qf_push_subscriptions s where s.user_id=e.user_id and s.ativo)
    returning user_id
  ) select coalesce(array_agg(user_id),array[]::uuid[]) into v_ids from reserved;
  return v_ids;
end $function$;

CREATE OR REPLACE FUNCTION public.qf_recarga_pagamento_aplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.qf_planos_catalogo; v_sobra integer; v_chamados integer; v_dias integer; v_bonus integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    if new.plano is not null then
      select * into c from public.qf_planos_catalogo where plano = new.plano;
      if c.plano is not null then
        if new.valor_centavos = c.preco_centavos then
          v_chamados := c.chamados; v_dias := c.dias;
        else
          select h.chamados, h.dias into v_chamados, v_dias
            from public.qf_planos_catalogo_hist h
           where h.plano = new.plano and h.preco_centavos = new.valor_centavos and h.substituido_em >= new.criado_em
           order by h.substituido_em
           limit 1;
        end if;
      end if;
      if v_chamados is not null then
        if not exists (select 1 from public.qf_planos_profissional where recarga_id = new.id) then
          select coalesce(sum(chamados_restantes),0) into v_sobra from public.qf_planos_profissional
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, recarga_id)
          values (new.profissional_id, c.plano, v_chamados, v_chamados + v_sobra, now() + make_interval(days => v_dias), new.id);
        end if;
        return null;
      end if;
    end if;
    if not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.referencia_tipo = 'recarga' and m.referencia_id = new.id and m.tipo = 'credito'
    ) then
      insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
      values (new.profissional_id, 0, 0, false)
      on conflict (profissional_id) do nothing;
      update public.qf_carteiras set saldo_centavos = saldo_centavos + new.valor_centavos, atualizado_em = now()
       where profissional_id = new.profissional_id;
      insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (new.profissional_id, 'credito', new.valor_centavos, 'recarga', new.id,
        'Recarga aprovada via ' || case new.metodo when 'pix' then 'Pix' when 'cartao' then 'Cartão' when 'boleto' then 'Boleto' else new.metodo end);
    end if;
    v_bonus := public.qf_bonus_recarga_centavos(new.valor_centavos);
    if v_bonus > 0 and not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.referencia_tipo = 'bonus_recarga' and m.referencia_id = new.id
    ) then
      update public.qf_carteiras set saldo_centavos = saldo_centavos + v_bonus, atualizado_em = now()
       where profissional_id = new.profissional_id;
      -- O gatilho qf_bonus_prazo_nova_concessao registra a validade de 30 dias.
      insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (new.profissional_id, 'bonus', v_bonus, 'bonus_recarga', new.id,
        'Bônus da recarga (vale por 30 dias)');
    end if;
  end if;
  return null;
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
