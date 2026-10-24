-- Snapshot dos desbloqueios e seleção próximos de produção, para testes locais sem cobranças reais.
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

  if not private.qf_pedido_acessivel_pro(p_chamado_id) then
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

CREATE OR REPLACE FUNCTION private.qf_livre_desbloquear(p_chamado_id uuid, p_aceitar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_prof uuid:=auth.uid(); c public.qf_chamados; n integer; lim integer; d uuid;
begin
 if v_prof is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 if p_aceitar is distinct from true then return jsonb_build_object('ok',false,'reason','aceite_obrigatorio');end if;
 -- Bônus vencido não conta como crédito (mesma regra do desbloqueio pago).
 perform private.qf_expirar_bonus_profissional(v_prof);
 if not private.qf_livre_acesso_ok(v_prof)
 then return jsonb_build_object('ok',false,'reason','plano_inativo');end if;
 if not exists(select 1 from public.qf_profissionais pr join public.qf_profiles p on p.id=pr.user_id
   where pr.user_id=v_prof and coalesce(p.ativo,true) and p.tipo='profissional' and pr.online is true)
 then return jsonb_build_object('ok',false,'reason','perfil_inativo');end if;
 if not exists(select 1 from public.qf_profiles where id=v_prof and nullif(trim(coalesce(foto_url,'')),'') is not null)
 then return jsonb_build_object('ok',false,'reason','selfie_obrigatoria');end if;
 if private.qf13_bloqueio(v_prof) is not null then return jsonb_build_object('ok',false,'reason',private.qf13_bloqueio(v_prof));end if;
 select * into c from public.qf_chamados where id=p_chamado_id for update;
 if not found or c.status not in ('aberto','em_negociacao') or c.atendimento_tipo='garante' or c.modalidade='valor_definido'
 then return jsonb_build_object('ok',false,'reason','indisponivel');end if;
 if not private.qf_livre_acesso_ok(v_prof) then return jsonb_build_object('ok',false,'reason','plano_inativo');end if;
 if exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and profissional_id=v_prof)
 then return jsonb_build_object('ok',false,'reason','ja_participou');end if;
 if exists(select 1 from public.qf_orcamentos where chamado_id=c.id and status='aceito')
 then return jsonb_build_object('ok',false,'reason','indisponivel');end if;
 lim:=least(4,public.qf_limite_orcamentos(c.id));
 select count(*) into n from public.qf_desbloqueios where chamado_id=c.id and coalesce(ativo,true);
 if n>=lim or exists(select 1 from public.qf_desbloqueios where chamado_id=c.id and exclusivo and coalesce(ativo,true))
 then return jsonb_build_object('ok',false,'reason','reservado','participantes',n,'limite',lim);end if;
 if not private.qf_pedido_acessivel_pro(c.id)
 then return jsonb_build_object('ok',false,'reason','nao_elegivel');end if;
 insert into public.qf_comissao13_adesoes(profissional_id,versao_termos,aceito_em,revogado_em)
 values(v_prof,'livre-13pct-v1',now(),null)
 on conflict(profissional_id) do update set versao_termos=excluded.versao_termos,aceito_em=now(),revogado_em=null;
 insert into public.qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem,ativo,exclusivo)
 values(c.id,v_prof,0,'comissao13',true,false) returning id into d;
 update public.qf_chamados set status='em_negociacao',atualizado_em=now() where id=c.id;
 perform private.qf_push_interno('professional_connected',c.id);
 return jsonb_build_object('ok',true,'desbloqueio_id',d,'origem','comissao13','plano','livre',
   'preco_centavos',0,'participantes',n+1,'limite',lim);
exception when unique_violation then return jsonb_build_object('ok',false,'reason','ja_participou');
end $function$;

CREATE OR REPLACE FUNCTION private.qf_pro_recebe_chamado(p_pro uuid, p_chamado_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select exists (
 select 1 from public.qf_chamados c
 join public.qf_profissionais pr on pr.user_id=p_pro
 where c.id=p_chamado_id
 and c.categoria=any(coalesce(pr.especialidades,array[]::text[]))
 and private.qf_pro_atende_regiao(p_pro,c.cidade,c.uf::text,c.latitude,c.longitude)
);
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

