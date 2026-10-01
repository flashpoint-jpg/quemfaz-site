-- QuemFaz 11.16.0
-- Reserva exclusiva: o primeiro profissional que desbloqueia reserva a conversa.
-- Se o cliente escolher "Ainda não", o pedido volta ao portfólio.

create unique index if not exists qf_desbloqueios_um_ativo_por_chamado
  on public.qf_desbloqueios(chamado_id)
  where coalesce(ativo,true);

CREATE OR REPLACE FUNCTION public.qf_cliente_continuar_procurando(p_chamado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_cliente uuid := auth.uid();
  v_status text;
  v_prof uuid;
begin
  if v_cliente is null then
    raise exception 'authentication required';
  end if;

  select c.status into v_status
  from public.qf_chamados c
  where c.id=p_chamado_id
    and c.cliente_id=v_cliente
  for update;

  if v_status is null then
    raise exception 'call not found';
  end if;

  if v_status not in ('em_negociacao','aberto') then
    return jsonb_build_object('ok',false,'reason','status_invalido','status',v_status);
  end if;

  select d.profissional_id into v_prof
  from public.qf_desbloqueios d
  where d.chamado_id=p_chamado_id
    and coalesce(d.ativo,true)
  order by d.criado_em desc
  limit 1
  for update;

  if v_prof is null then
    update public.qf_chamados
       set status='aberto',atualizado_em=now()
     where id=p_chamado_id;
    return jsonb_build_object('ok',true,'status','aberto','sem_reserva',true);
  end if;

  update public.qf_desbloqueios
     set ativo=false
   where chamado_id=p_chamado_id
     and profissional_id=v_prof
     and coalesce(ativo,true);

  update public.qf_orcamentos
     set status='cancelado',
         motivo_recusa='Cliente decidiu continuar procurando profissionais.',
         atualizado_em=now()
   where chamado_id=p_chamado_id
     and profissional_id=v_prof
     and status in ('enviado','recusado');

  update public.qf_chamados
     set status='aberto',atualizado_em=now()
   where id=p_chamado_id;

  return jsonb_build_object(
    'ok',true,
    'status','aberto',
    'profissional_id',v_prof,
    'message','Pedido devolvido ao portfólio.'
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
      'limite',1
    )
    else jsonb_build_object('ok',false,'reason','forbidden')
  end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_desbloquear_chamado(p_chamado_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_prof uuid := auth.uid();
  v_preco integer;
  v_saldo bigint;
  v_status text;
  v_existing_valor integer;
  v_existing_origem text;
  v_existing_ativo boolean;
  v_plano_id uuid;
  v_plano_restantes integer;
  v_pendencia uuid;
  v_reservado_por uuid;
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
        'participantes',1,'limite',1
      );
    end if;
    return jsonb_build_object('ok',false,'reason','ja_participou');
  end if;

  -- Trava o chamado para garantir que só o primeiro profissional consiga reservar.
  select c.status,coalesce(p.preco_centavos,padrao.preco_centavos,790)
    into v_status,v_preco
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

  select d.profissional_id into v_reservado_por
  from public.qf_desbloqueios d
  where d.chamado_id=p_chamado_id
    and coalesce(d.ativo,true)
  order by d.criado_em
  limit 1;

  if v_reservado_por is not null and v_reservado_por<>v_prof then
    return jsonb_build_object(
      'ok',false,'reason','reservado',
      'message','Outro profissional desbloqueou este serviço primeiro.'
    );
  end if;

  if not exists(
    select 1 from public.qf_listar_chamados_disponiveis() d
    where d.id=p_chamado_id
  ) then
    return jsonb_build_object('ok',false,'reason','nao_elegivel');
  end if;

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
      'ok',true,'origem','plano','usou_bonus',false,
      'preco_centavos',0,'preco_tabela_centavos',v_preco,
      'plano_restantes',v_plano_restantes-1,
      'participantes',1,'limite',1
    );
  end if;

  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(v_prof,0,0,true)
  on conflict(profissional_id) do update
    set bonus_inicial_usado=true;

  select saldo_centavos into v_saldo
  from public.qf_carteiras
  where profissional_id=v_prof
  for update;

  if coalesce(v_saldo,0)<v_preco then
    return jsonb_build_object(
      'ok',false,'reason','saldo_insuficiente',
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
  values(v_prof,'debito',v_preco,'chamado',p_chamado_id,'Desbloqueio de chamado');

  insert into public.qf_desbloqueios(
    chamado_id,profissional_id,valor_centavos,origem,ativo
  )
  values(p_chamado_id,v_prof,v_preco,'saldo',true);

  update public.qf_chamados
     set status='em_negociacao',atualizado_em=now()
   where id=p_chamado_id;

  perform private.qf_push_interno('professional_connected',p_chamado_id);

  return jsonb_build_object(
    'ok',true,'origem','saldo','usou_bonus',false,
    'preco_centavos',v_preco,'preco_tabela_centavos',v_preco,
    'saldo_centavos',v_saldo-v_preco,
    'participantes',1,'limite',1
  );
exception
  when unique_violation then
    return jsonb_build_object('ok',false,'reason','reservado');
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
    0::integer as participantes,
    1::integer as limite
  from public.qf_listar_chamados_disponiveis() d
  where not exists (
    select 1
    from public.qf_desbloqueios x
    where x.chamado_id=d.id
      and coalesce(x.ativo,true)
  )
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


revoke execute on function public.qf_portfolio_servicos() from public, anon;
revoke execute on function public.qf_cliente_continuar_procurando(uuid) from public, anon;
revoke execute on function public.qf_contagem_participantes(uuid) from public, anon;
grant execute on function public.qf_portfolio_servicos() to authenticated;
grant execute on function public.qf_cliente_continuar_procurando(uuid) to authenticated;
grant execute on function public.qf_contagem_participantes(uuid) to authenticated;
