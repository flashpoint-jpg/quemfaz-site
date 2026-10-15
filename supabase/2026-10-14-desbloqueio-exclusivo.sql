-- V11.90: no máximo 4 profissionais por pedido e desbloqueio exclusivo.
-- Exclusivo: só enquanto ninguém desbloqueou; custa N× o preço (qf_config desbloqueio_exclusivo, padrão 3×),
-- é pago com créditos (não usa chamado do plano) e fecha o pedido para os outros.

-- 1) Máximo de 4 orçamentos por pedido (os 2 pedidos abertos com 8 passam a 4; nenhum tinha mais de 3 desbloqueios).
update public.qf_chamados set max_orcamentos = 4 where max_orcamentos > 4;
alter table public.qf_chamados drop constraint if exists qf_chamados_max_orcamentos_check;
alter table public.qf_chamados add constraint qf_chamados_max_orcamentos_check check (max_orcamentos >= 1 and max_orcamentos <= 4);

-- 2) Marca do desbloqueio exclusivo.
alter table public.qf_desbloqueios add column if not exists exclusivo boolean not null default false;

-- 3) Com exclusivo ativo o pedido tem 1 vaga só (e ela está ocupada).
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

-- 4) Configuração (painel).
insert into public.qf_config (chave, valor, atualizado_em)
values ('desbloqueio_exclusivo', '{"ativo": true, "multiplicador": 3}'::jsonb, now())
on conflict (chave) do nothing;

CREATE OR REPLACE FUNCTION public.qf_exclusivo_info()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'ativo', coalesce((c.valor->>'ativo')::boolean, true),
    'multiplicador', coalesce((c.valor->>'multiplicador')::numeric, 3)
  )
  from (select (select x.valor from public.qf_config x where x.chave = 'desbloqueio_exclusivo') as valor) c;
$function$;
GRANT EXECUTE ON FUNCTION public.qf_exclusivo_info() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.qf_admin_salvar_exclusivo(p_ativo boolean, p_multiplicador numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if p_multiplicador is null or p_multiplicador < 1.5 or p_multiplicador > 10 then
    return jsonb_build_object('ok', false, 'reason', 'Use de 1,5× a 10×.');
  end if;
  insert into public.qf_config (chave, valor, atualizado_em)
  values ('desbloqueio_exclusivo', jsonb_build_object('ativo', coalesce(p_ativo, false), 'multiplicador', round(p_multiplicador, 1)), now())
  on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('ok', true) || public.qf_exclusivo_info();
end;
$function$;
REVOKE ALL ON FUNCTION public.qf_admin_salvar_exclusivo(boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qf_admin_salvar_exclusivo(boolean, numeric) TO authenticated;

-- 5) Desbloqueio com a opção exclusiva (o app antigo continua chamando só com p_chamado_id = dividido).
DROP FUNCTION IF EXISTS public.qf_desbloquear_chamado(uuid);
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

  -- Trava o chamado para a contagem das vagas não passar do limite.
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

  -- Plano cobre só o desbloqueio dividido; o exclusivo é pago com créditos.
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
