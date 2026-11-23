-- Ativação do 24 Livre pelas rotinas Pix e cotas existentes.
alter table public.qf_planos_catalogo drop constraint qf_planos_catalogo_plano_check;
alter table public.qf_planos_catalogo add constraint qf_planos_catalogo_plano_check check (plano in ('mensal','pro','premium','avulso','livre','basico_v2','pro_v2','completo_v2','livre_24h'));
alter table public.qf_recargas drop constraint qf_recargas_plano_check;
alter table public.qf_recargas add constraint qf_recargas_plano_check check (plano in ('mensal','pro','premium','livre','basico_v2','pro_v2','completo_v2','livre_24h'));
alter table public.qf_planos_profissional drop constraint qf_planos_profissional_plano_check;
alter table public.qf_planos_profissional add constraint qf_planos_profissional_plano_check check (plano in ('mensal','pro','premium','basico_v2','pro_v2','completo_v2','livre_24h'));
insert into public.qf_planos_catalogo(plano,nome,preco_centavos,chamados,dias,ativo)
values('livre_24h','24 Livre',5900,20,30,true);

CREATE OR REPLACE FUNCTION private.qf_ativar_pacote_v2(p_recarga uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.qf_recargas; esperado integer; quantidade integer;
begin
 select * into r from public.qf_recargas where id=p_recarga for update;
 if not found then return 'nao_encontrada'; end if;
 if r.plano not in ('basico_v2','pro_v2','completo_v2','livre_24h')
 then return 'plano_invalido'; end if;
 esperado:=case r.plano when 'basico_v2' then 3990 when 'pro_v2' then 7990 when 'livre_24h' then 5900 else 14990 end;
 quantidade:=case r.plano when 'basico_v2' then 10 when 'pro_v2' then 25 when 'livre_24h' then 20 else 100 end;
 if r.status<>'aprovado' or r.metodo<>'pix' or r.provedor<>'efi'
    or nullif(r.provedor_id,'') is null or r.valor_centavos<>esperado
    or r.aprovado_em is null then return 'pagamento_nao_confirmado'; end if;
 if not exists(select 1 from public.qf_profissionais where user_id=r.profissional_id)
 then return 'profissional_nao_encontrado'; end if;
 if exists(select 1 from public.qf_planos_profissional where recarga_id=r.id)
 then return 'ja_ativado'; end if;
 -- Sem zerar pacotes legados ou carregar cotas velhas para um contrato novo.
 insert into public.qf_planos_profissional
 (profissional_id,plano,chamados_total,chamados_restantes,valido_ate,recarga_id,origem)
 values(r.profissional_id,r.plano,quantidade,quantidade,now()+interval '30 days',r.id,'pix');
 return 'ativado';
end $function$;

CREATE OR REPLACE FUNCTION public.qf_recarga_pagamento_aplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='aprovado' and old.status is distinct from 'aprovado' then
  if new.plano in ('basico_v2','pro_v2','completo_v2','livre_24h') then
   if private.qf_ativar_pacote_v2(new.id) not in ('ativado','ja_ativado') then
    raise exception 'Pix do pacote novo não confirmado ou valor incorreto';
   end if;
  elsif new.plano='livre' then
   if private.qf_livre_ativar_recarga(new.id) not in ('ativada','ja_ativada') then raise exception 'Pagamento Livre sem confirmação válida';end if;
  else
   begin perform private.qf_aplicar_beneficio_recarga(new.id);
   exception when others then perform private.qf_log_pagamento(new.id,new.profissional_id,'erro_beneficio',jsonb_build_object('erro',sqlerrm,'sqlstate',sqlstate));end;
  end if;
 end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.qf_handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_cats text[];
  v_raio integer;
  v_cidade text;
  v_uf text;
  v_pago public.qf_pre_cadastro_pagamentos;
  v_pagamento_id uuid;
  v_segredo text;
  v_convite jsonb;
  v_exploracao private.qf_cadastro_exploracao_pendente;
  v_telefone text;
begin
  v_role := coalesce(new.raw_user_meta_data ->> 'qf_role', 'cliente');
  if v_role not in ('cliente','profissional') then
    v_role := 'cliente';
  end if;
  -- A escolha "profissional" vinda do cliente nunca concede acesso por si so.
  -- O comprovante é apenas uma referência: o banco valida valor, titularidade,
  -- situação da cobrança e unicidade de utilização ANTES de criar o perfil.
  if v_role = 'profissional' then
    if nullif(new.raw_user_meta_data->>'qf_convite_24h','') IS NOT NULL then
      v_convite := private.qf_convite_24h_usar(new.id,new.email,new.raw_user_meta_data->>'qf_convite_24h');
      if coalesce((v_convite->>'ok')::boolean,false) IS DISTINCT FROM true then
        raise exception 'Convite de 24 horas inválido ou utilizado' using errcode='P0001';
      end if;
    elsif nullif(new.raw_user_meta_data->>'qf_cadastro_exploracao_token','') is not null then
      v_telefone := regexp_replace(coalesce(new.raw_user_meta_data->>'qf_telefone',''),'[^0-9]','','g');
      if length(v_telefone)=13 and left(v_telefone,2)='55' then
        v_telefone := substr(v_telefone,3);
      end if;
      perform pg_advisory_xact_lock(hashtextextended('qf_cadastro_exploracao:' || v_telefone,0));
      delete from private.qf_cadastro_exploracao_pendente
        where token=(new.raw_user_meta_data->>'qf_cadastro_exploracao_token')::uuid
          and email=lower(trim(new.email)) and telefone=v_telefone and expira_em>now()
        returning * into v_exploracao;
      if not found
         or not coalesce((public.qf_pre_cadastro_telefone_elegivel(v_telefone)->>'ok')::boolean,false)
         or exists(select 1 from public.qf_pre_cadastro_pagamentos
           where documento_hash=v_exploracao.documento_hash and status in ('pendente','aprovado')) then
        raise exception 'Identidade indisponível para cadastro' using errcode='P0001';
      end if;
      insert into private.qf_identidades(user_id,cpf_hash,cpf_last4,cnpj_hash,cnpj_last4,atualizado_em)
      values(new.id,
        case when v_exploracao.documento_tipo='cpf' then v_exploracao.documento_hash end,
        case when v_exploracao.documento_tipo='cpf' then v_exploracao.documento_final end,
        case when v_exploracao.documento_tipo='cnpj' then v_exploracao.documento_hash end,
        case when v_exploracao.documento_tipo='cnpj' then v_exploracao.documento_final end,
        now()
      );
      insert into private.qf_cadastros_exploracao(user_id) values(new.id);
    else
    if nullif(new.raw_user_meta_data->>'qf_pre_cadastro_id','') is null
       or nullif(new.raw_user_meta_data->>'qf_pre_cadastro_segredo','') is null
    then
      raise exception 'É necessário pagar o plano escolhido para concluir seu cadastro.'
        using errcode='P0001';
    end if;
    v_pagamento_id := (new.raw_user_meta_data->>'qf_pre_cadastro_id')::uuid;
    v_segredo := new.raw_user_meta_data->>'qf_pre_cadastro_segredo';
    select * into v_pago from public.qf_pre_cadastro_pagamentos
      where id=v_pagamento_id and segredo=v_segredo for update;
    if not found or v_pago.profissional_id is not null or
       v_pago.status<>'aprovado' or v_pago.provedor<>'efi' or
       nullif(v_pago.provedor_id,'') is null or
       v_pago.metodo<>'pix' or
       lower(trim(v_pago.email)) is distinct from lower(trim(new.email)) or
       not (
         (v_pago.plano='avulso' and v_pago.valor_centavos in (1300,1499)) or
         (v_pago.plano='livre' and v_pago.valor_centavos=3990) or
         (v_pago.plano='livre_24h' and v_pago.valor_centavos=5900) or
         (v_pago.plano='basico_v2' and v_pago.valor_centavos=3990) or
         (v_pago.plano='pro_v2' and v_pago.valor_centavos=7990) or
         (v_pago.plano='completo_v2' and v_pago.valor_centavos=14990)
       )
    then
      raise exception 'É necessário pagar o plano escolhido para concluir seu cadastro.'
        using errcode='P0001';
    end if;
    -- Um pagamento só pode ser vinculado a uma identidade.
    insert into private.qf_cadastro_pagamento_vinculo(user_id,pagamento_id)
      values(new.id,v_pago.id);

    -- Registrar CPF/CNPJ em hash ANTES da criação do perfil; não depender de
    -- localStorage, outro login, e-mail ou clique posterior. Um hash = uma conta.
    if v_pago.documento_hash is not null then
      if v_pago.documento_tipo='cpf' then
        insert into private.qf_identidades(user_id,cpf_hash,cpf_last4,atualizado_em)
        values(new.id,v_pago.documento_hash,v_pago.documento_final,now());
      elsif v_pago.documento_tipo='cnpj' then
        insert into private.qf_identidades(user_id,cnpj_hash,cnpj_last4,atualizado_em)
        values(new.id,v_pago.documento_hash,v_pago.documento_final,now());
      else
        raise exception 'CPF ou CNPJ inválido para cadastro profissional';
      end if;
    end if;
    end if;
  end if;

  v_cidade := nullif(new.raw_user_meta_data ->> 'qf_cidade','');
  v_uf := upper(nullif(new.raw_user_meta_data ->> 'qf_uf',''));

  insert into public.qf_profiles(
    id, tipo, nome, telefone, whatsapp, cidade, uf, ativo
  )
  values (
    new.id,
    v_role,
    coalesce(nullif(new.raw_user_meta_data ->> 'qf_nome',''), new.email, 'Usuário'),
    coalesce(new.raw_user_meta_data ->> 'qf_telefone',''),
    coalesce(new.raw_user_meta_data ->> 'qf_telefone',''),
    v_cidade,
    v_uf,
    true
  )
  on conflict (id) do nothing;

  if v_role = 'profissional' then
    begin
      select coalesce(array_agg(x), '{}'::text[])
      into v_cats
      from jsonb_array_elements_text(
        coalesce(new.raw_user_meta_data -> 'qf_categorias', '[]'::jsonb)
      ) as t(x);
    exception when others then
      v_cats := '{}'::text[];
    end;

    begin
      v_raio := greatest(1, least(300, coalesce((new.raw_user_meta_data ->> 'qf_raio_km')::integer, 10)));
    exception when others then
      v_raio := 10;
    end;

    insert into public.qf_profissionais(
      user_id, especialidades, raio_km, online
    )
    values (new.id, coalesce(v_cats,'{}'::text[]), v_raio, false)
    on conflict (user_id) do nothing;

    if v_cidade is not null and v_uf is not null then
      insert into public.qf_profissional_cidades(
        profissional_id, cidade, uf, raio_km
      )
      values (new.id, v_cidade, v_uf, v_raio)
      on conflict (profissional_id, cidade, uf)
      do update set raio_km = excluded.raio_km;
    end if;
  end if;

  if nullif(new.raw_user_meta_data->>'qf_convite_24h','') IS NOT NULL then
    update auth.users set raw_user_meta_data=raw_user_meta_data-'qf_convite_24h' where id=new.id;
  end if;
  if new.raw_user_meta_data ? 'qf_cadastro_exploracao_token' then
    update auth.users set raw_user_meta_data=raw_user_meta_data-'qf_cadastro_exploracao_token' where id=new.id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.qf_resgatar_pre_cadastro(p_id uuid, p_segredo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid:=auth.uid(); r public.qf_pre_cadastro_pagamentos; v_rec uuid;
        v_email text; v_vinculo uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.qf_profissionais p WHERE p.user_id=v_uid) THEN
   RETURN jsonb_build_object('ok',false,'error','perfil_profissional_pendente');
 END IF;
 SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id=v_uid;
 SELECT * INTO r FROM public.qf_pre_cadastro_pagamentos
   WHERE id=p_id AND segredo=p_segredo FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','nao_encontrado'); END IF;
 IF v_email IS DISTINCT FROM lower(trim(r.email)) THEN
   RETURN jsonb_build_object('ok',false,'error','email_divergente');
 END IF;
 IF r.profissional_id IS NOT NULL THEN
   IF r.profissional_id=v_uid AND r.recarga_id IS NOT NULL THEN
     RETURN jsonb_build_object('ok',true,'ja_resgatado',true,'plano',r.plano,'recarga_id',r.recarga_id);
   END IF;
   RETURN jsonb_build_object('ok',false,'error','ja_usado');
 END IF;
 IF r.status <> 'aprovado' OR r.provedor<>'efi' OR nullif(r.provedor_id,'') IS NULL THEN
   RETURN jsonb_build_object('ok',false,'error','nao_pago','status',r.status);
 END IF;
 IF r.plano IN ('avulso','basico_v2','pro_v2','completo_v2','livre_24h') THEN
   SELECT pagamento_id INTO v_vinculo FROM private.qf_cadastro_pagamento_vinculo WHERE user_id=v_uid;
   IF v_vinculo IS DISTINCT FROM r.id OR
      NOT ((r.plano='avulso' AND r.valor_centavos=1499)
        OR (r.plano='livre_24h' AND r.valor_centavos=5900 AND r.metodo='pix')
        OR (r.plano='basico_v2' AND r.valor_centavos=3990)
        OR (r.plano='pro_v2' AND r.valor_centavos=7990)
        OR (r.plano='completo_v2' AND r.valor_centavos=14990)) THEN
       RETURN jsonb_build_object('ok',false,'error','vinculo_invalido');
   END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM private.qf_profissionais_anteriores_pagamento WHERE user_id=v_uid) THEN
   RETURN jsonb_build_object('ok',false,'error','plano_invalido');
 END IF;
 INSERT INTO public.qf_recargas(profissional_id,valor_centavos,metodo,status,provedor,provedor_id,plano)
 VALUES(v_uid,r.valor_centavos,r.metodo,'pendente',r.provedor,r.provedor_id,
        CASE WHEN r.plano='avulso' THEN NULL ELSE r.plano END)
 RETURNING id INTO v_rec;
 UPDATE public.qf_recargas SET status='aprovado' WHERE id=v_rec;
 IF r.plano='avulso' AND NOT EXISTS(
   SELECT 1 FROM public.qf_movimentacoes_carteira m
   WHERE m.profissional_id=v_uid AND m.referencia_tipo='recarga'
   AND m.referencia_id=v_rec AND m.tipo='credito' AND m.valor_centavos=1499
 ) THEN
   RAISE EXCEPTION 'Falha ao creditar a recarga inicial';
 END IF;
 UPDATE public.qf_pre_cadastro_pagamentos
  SET profissional_id=v_uid,recarga_id=v_rec,resgatado_em=now()
  WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'plano',r.plano,'recarga_id',r.recarga_id,'valor_centavos',r.valor_centavos);
END $function$;

CREATE OR REPLACE FUNCTION private.qf_cadastro_pagamento_original_ok(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(
   SELECT 1 FROM private.qf_profissionais_anteriores_pagamento a WHERE a.user_id=p_uid
 ) OR EXISTS(
   SELECT 1 FROM private.qf_cadastro_pagamento_vinculo v
   JOIN public.qf_pre_cadastro_pagamentos p ON p.id=v.pagamento_id
   JOIN auth.users u ON u.id=v.user_id
   WHERE v.user_id=p_uid
     AND p.status='aprovado' AND p.provedor='efi'
     AND nullif(p.provedor_id,'') IS NOT NULL
     AND lower(trim(p.email))=lower(trim(u.email))
     AND ((p.plano='avulso' AND p.valor_centavos in (1300,1499))
       OR (p.plano='livre' AND p.valor_centavos=3990 AND p.metodo='pix')
       OR (p.plano='livre_24h' AND p.valor_centavos=5900 AND p.metodo='pix')
       OR (p.plano='basico_v2' AND p.valor_centavos=3990 AND p.metodo='pix')
       OR (p.plano='pro_v2' AND p.valor_centavos=7990 AND p.metodo='pix')
       OR (p.plano='completo_v2' AND p.valor_centavos=14990 AND p.metodo='pix'))
 );
$function$;

CREATE OR REPLACE FUNCTION public.qf_solicitar_plano(p_plano text, p_metodo text DEFAULT 'pix'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); c public.qf_planos_catalogo; v_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.qf_profissionais p where p.user_id = v_uid) then raise exception 'professional profile required'; end if;
  if p_metodo <> 'pix' then raise exception 'Novo plano exige Pix'; end if;
  if p_plano not in ('basico_v2','pro_v2','completo_v2','livre_24h') then raise exception 'Plano substituído; escolha Básico, Pro, Completo ou 24 Livre'; end if;
  select * into c from public.qf_planos_catalogo where plano = p_plano and ativo;
  if c.plano is null then raise exception 'invalid plan'; end if;
  if p_plano='livre_24h' then
    perform pg_advisory_xact_lock(hashtextextended('livre_24h:'||v_uid::text,0));
    if private.qf_plantao_plano_ativo(v_uid) then raise exception 'O 24 Livre já está ativo'; end if;
    select id into v_id from public.qf_recargas
    where profissional_id=v_uid and plano=p_plano and status='pendente'
      and criado_em>now()-interval '24 hours'
    order by criado_em desc limit 1;
  end if;
  if v_id is null then
    insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, plano)
    values (v_uid, c.preco_centavos, p_metodo, 'pendente', c.plano)
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'recarga_id', v_id, 'status', 'pendente', 'valor_centavos', c.preco_centavos,
                            'metodo', p_metodo, 'plano', c.plano, 'chamados', c.chamados, 'dias', c.dias);
end $function$;

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
  v_exploracao boolean := false;
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

  select exists(select 1 from private.qf_cadastros_exploracao where user_id=v_prof) into v_exploracao;
  v_preco := v_preco_tabela;
  if coalesce(v_garante,false) then
    v_preco := v_preco_tabela * case
      when public.qf_limite_orcamentos(p_chamado_id)=4 then 4
      else 1 end;
  elsif v_exclusivo then
    if public.qf_limite_orcamentos(p_chamado_id) <> 4 then
      return jsonb_build_object('ok',false,'reason','exclusivo_indisponivel');
    end if;
    v_excl := public.qf_exclusivo_info();
    if not coalesce((v_excl->>'ativo')::boolean, false) then
      return jsonb_build_object('ok',false,'reason','exclusivo_desligado');
    end if;
    if v_participantes > 0 then
      return jsonb_build_object('ok',false,'reason','exclusivo_indisponivel','participantes',v_participantes);
    end if;
    v_preco := ceil(v_preco_tabela * coalesce((v_excl->>'multiplicador')::numeric, 3))::integer;
  end if;

  if v_exploracao then v_preco := v_preco + 200; end if;

  if not private.qf_pedido_acessivel_pro(p_chamado_id) then
    return jsonb_build_object('ok',false,'reason','nao_elegivel');
  end if;

  -- One courtesy per existing professional, restricted to the frozen request snapshot.
  if not v_exploracao and not v_exclusivo and private.qf_cortesia_reativacao_20261022(p_chamado_id) then
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
      and (not v_exploracao or plano='livre_24h')
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
CREATE OR REPLACE FUNCTION public.qf_plano_v2_pagamento_status(p_recarga_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_status text; v_plano text; v_pacote uuid;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado'); end if;
 select status,plano into v_status,v_plano from public.qf_recargas
 where id=p_recarga_id and profissional_id=auth.uid();
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado'); end if;
 if v_plano not in ('basico_v2','pro_v2','completo_v2','livre_24h')
 then return jsonb_build_object('ok',false,'reason','plano_invalido'); end if;
 select id into v_pacote from public.qf_planos_profissional
 where recarga_id=p_recarga_id and profissional_id=auth.uid()
 and valido_ate>now() limit 1;
 return jsonb_build_object('ok',true,'status',v_status,
   'ativo',v_status='aprovado' and v_pacote is not null,'plano',v_plano);
end $function$;

