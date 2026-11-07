-- Cadastro profissional para conhecer o painel, separado da adesão paga.
create table private.qf_cadastros_exploracao (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table private.qf_cadastros_exploracao enable row level security;
revoke all on private.qf_cadastros_exploracao from public, anon, authenticated;

create table private.qf_cadastro_exploracao_pendente (
  token uuid primary key default gen_random_uuid(),
  email text not null,
  telefone text not null,
  documento_tipo text not null,
  documento_hash text not null,
  documento_final text not null,
  expira_em timestamptz not null default now()+interval '10 minutes'
);
create index on private.qf_cadastro_exploracao_pendente(expira_em);
alter table private.qf_cadastro_exploracao_pendente enable row level security;
revoke all on private.qf_cadastro_exploracao_pendente from public, anon, authenticated;

create function public.qf_preparar_cadastro_exploracao(p_email text,p_tipo text,p_documento text,p_telefone text)
returns jsonb
language plpgsql security definer set search_path to ''
as $
declare
  v_email text := lower(trim(coalesce(p_email,'')));
  v_telefone text := regexp_replace(coalesce(p_telefone,''),'[^0-9]','','g');
  v_identidade jsonb;
  v_token uuid;
begin
  if length(v_telefone)=13 and left(v_telefone,2)='55' then
    v_telefone := substr(v_telefone,3);
  end if;
  if length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+
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
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION qf_private.conceder_bonus_lancamento_profissional()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows integer := 0;
  v_cfg jsonb := (select c.valor from public.qf_config c where c.chave = 'bonus_cadastro');
  v_ativo boolean := coalesce((v_cfg->>'ativo')::boolean, false);
  v_valor integer := least(greatest(coalesce((v_cfg->>'valor_centavos')::integer, 0), 0), 10000);
begin
  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(new.user_id,0,0,true)
  on conflict(profissional_id) do update
  set bonus_inicial_usado=true;

  -- V11.48: bônus desligado (ou valor zero) no painel: cria só a carteira, sem crédito.
  if not v_ativo or v_valor <= 0 or exists (
    select 1 from private.qf_cadastros_exploracao where user_id=new.user_id
  ) then
    return new;
  end if;

  insert into public.qf_movimentacoes_carteira(
    profissional_id,tipo,valor_centavos,referencia_tipo,descricao
  )
  values(
    new.user_id,'bonus',v_valor,'bonus_lancamento',
    'Bônus de cadastro QuemFaz — R$ ' || replace(to_char(v_valor / 100.0, 'FM999990.00'), '.', ',')
  )
  on conflict do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    update public.qf_carteiras
       set saldo_centavos=saldo_centavos+v_valor,
           atualizado_em=now()
     where profissional_id=new.user_id;
  end if;

  return new;
end;
$function$;

-- Uma confirmação de recarga é necessária antes do primeiro desbloqueio.
-- O RPC atual continua responsável por verificar e debitar o saldo ou cota.
create function private.qf_exigir_recarga_exploracao()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if exists(select 1 from private.qf_cadastros_exploracao where user_id=new.profissional_id)
     and not exists (
       select 1 from public.qf_recargas
       where profissional_id=new.profissional_id and status='aprovado'
         and valor_centavos>0 and provedor='efi' and nullif(provedor_id,'') is not null
     ) then
    raise exception 'Adicione saldo à carteira para desbloquear o pedido.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.qf_exigir_recarga_exploracao() from public, anon, authenticated;
create trigger qf_exigir_recarga_exploracao before insert on public.qf_desbloqueios
for each row execute function private.qf_exigir_recarga_exploracao();

-- Um orçamento direto não pode contornar o desbloqueio para essas contas.
create function private.qf_exigir_desbloqueio_exploracao()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if exists(select 1 from private.qf_cadastros_exploracao where user_id=new.profissional_id)
     and not exists (
       select 1 from public.qf_desbloqueios
       where profissional_id=new.profissional_id and chamado_id=new.chamado_id and coalesce(ativo,true)
     ) then
    raise exception 'Desbloqueie o pedido antes de enviar um orçamento.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.qf_exigir_desbloqueio_exploracao() from public, anon, authenticated;
create trigger qf_exigir_desbloqueio_exploracao before insert or update of chamado_id, profissional_id on public.qf_orcamentos
for each row execute function private.qf_exigir_desbloqueio_exploracao();

     or p_tipo is null or p_tipo not in ('cpf','cnpj')
     or v_telefone !~ '^[1-9][0-9]9[0-9]{8}
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
  v_identidade jsonb;
  v_doc_tipo text;
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
    elsif new.raw_user_meta_data->'qf_cadastro_exploracao' = 'true'::jsonb then
      v_doc_tipo := new.raw_user_meta_data->>'qf_documento_tipo_cadastro';
      v_telefone := regexp_replace(coalesce(new.raw_user_meta_data->>'qf_telefone',''),'[^0-9]','','g');
      if length(v_telefone) = 13 and left(v_telefone,2) = '55' then
        v_telefone := substr(v_telefone,3);
      end if;
      if v_doc_tipo is null or v_doc_tipo not in ('cpf','cnpj')
         or v_telefone !~ '^[1-9][0-9]9[0-9]{8} is null
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
    update auth.users
      set raw_user_meta_data=raw_user_meta_data-'qf_cadastro_exploracao_token'
      where id=new.id;
  end if;
  return new;
end;
$function$;
 then
        raise exception 'CPF, CNPJ ou telefone inválido' using errcode='P0001';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('qf_cadastro_exploracao:' || v_telefone,0));
      v_identidade := public.qf_pre_cadastro_documento_elegivel(
        v_doc_tipo,new.raw_user_meta_data->>'qf_documento_cadastro',v_telefone
      );
      if not coalesce((v_identidade->>'ok')::boolean,false)
         or not coalesce((public.qf_pre_cadastro_telefone_elegivel(v_telefone)->>'ok')::boolean,false) then
        raise exception 'Identidade indisponível para cadastro' using errcode='P0001';
      end if;
      insert into private.qf_identidades(user_id,cpf_hash,cpf_last4,cnpj_hash,cnpj_last4,atualizado_em)
      values(new.id,
        case when v_doc_tipo='cpf' then v_identidade->>'documento_hash' end,
        case when v_doc_tipo='cpf' then v_identidade->>'documento_final' end,
        case when v_doc_tipo='cnpj' then v_identidade->>'documento_hash' end,
        case when v_doc_tipo='cnpj' then v_identidade->>'documento_final' end,
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
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION qf_private.conceder_bonus_lancamento_profissional()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows integer := 0;
  v_cfg jsonb := (select c.valor from public.qf_config c where c.chave = 'bonus_cadastro');
  v_ativo boolean := coalesce((v_cfg->>'ativo')::boolean, false);
  v_valor integer := least(greatest(coalesce((v_cfg->>'valor_centavos')::integer, 0), 0), 10000);
begin
  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(new.user_id,0,0,true)
  on conflict(profissional_id) do update
  set bonus_inicial_usado=true;

  -- V11.48: bônus desligado (ou valor zero) no painel: cria só a carteira, sem crédito.
  if not v_ativo or v_valor <= 0 or exists (
    select 1 from private.qf_cadastros_exploracao where user_id=new.user_id
  ) then
    return new;
  end if;

  insert into public.qf_movimentacoes_carteira(
    profissional_id,tipo,valor_centavos,referencia_tipo,descricao
  )
  values(
    new.user_id,'bonus',v_valor,'bonus_lancamento',
    'Bônus de cadastro QuemFaz — R$ ' || replace(to_char(v_valor / 100.0, 'FM999990.00'), '.', ',')
  )
  on conflict do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    update public.qf_carteiras
       set saldo_centavos=saldo_centavos+v_valor,
           atualizado_em=now()
     where profissional_id=new.user_id;
  end if;

  return new;
end;
$function$;

-- Uma confirmação de recarga é necessária antes do primeiro desbloqueio.
-- O RPC atual continua responsável por verificar e debitar o saldo ou cota.
create function private.qf_exigir_recarga_exploracao()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if exists(select 1 from private.qf_cadastros_exploracao where user_id=new.profissional_id)
     and not exists (
       select 1 from public.qf_recargas
       where profissional_id=new.profissional_id and status='aprovado'
         and valor_centavos>0 and provedor='efi' and nullif(provedor_id,'') is not null
     ) then
    raise exception 'Adicione saldo à carteira para desbloquear o pedido.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.qf_exigir_recarga_exploracao() from public, anon, authenticated;
create trigger qf_exigir_recarga_exploracao before insert on public.qf_desbloqueios
for each row execute function private.qf_exigir_recarga_exploracao();

-- Um orçamento direto não pode contornar o desbloqueio para essas contas.
create function private.qf_exigir_desbloqueio_exploracao()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if exists(select 1 from private.qf_cadastros_exploracao where user_id=new.profissional_id)
     and not exists (
       select 1 from public.qf_desbloqueios
       where profissional_id=new.profissional_id and chamado_id=new.chamado_id and coalesce(ativo,true)
     ) then
    raise exception 'Desbloqueie o pedido antes de enviar um orçamento.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.qf_exigir_desbloqueio_exploracao() from public, anon, authenticated;
create trigger qf_exigir_desbloqueio_exploracao before insert or update of chamado_id, profissional_id on public.qf_orcamentos
for each row execute function private.qf_exigir_desbloqueio_exploracao();
 then
    return jsonb_build_object('ok',false);
  end if;
  v_identidade := public.qf_pre_cadastro_documento_elegivel(p_tipo,p_documento,v_telefone);
  if not coalesce((v_identidade->>'ok')::boolean,false)
     or not coalesce((public.qf_pre_cadastro_telefone_elegivel(v_telefone)->>'ok')::boolean,false) then
    return jsonb_build_object('ok',false);
  end if;
  delete from private.qf_cadastro_exploracao_pendente where expira_em<=now();
  insert into private.qf_cadastro_exploracao_pendente(email,telefone,documento_tipo,documento_hash,documento_final)
  values(v_email,v_telefone,p_tipo,v_identidade->>'documento_hash',v_identidade->>'documento_final')
  returning token into v_token;
  return jsonb_build_object('ok',true,'token',v_token);
end;
$;
revoke all on function public.qf_preparar_cadastro_exploracao(text,text,text,text) from public, anon, authenticated;
grant execute on function public.qf_preparar_cadastro_exploracao(text,text,text,text) to anon, authenticated;

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
  v_identidade jsonb;
  v_doc_tipo text;
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
    elsif new.raw_user_meta_data->'qf_cadastro_exploracao' = 'true'::jsonb then
      v_doc_tipo := new.raw_user_meta_data->>'qf_documento_tipo_cadastro';
      v_telefone := regexp_replace(coalesce(new.raw_user_meta_data->>'qf_telefone',''),'[^0-9]','','g');
      if length(v_telefone) = 13 and left(v_telefone,2) = '55' then
        v_telefone := substr(v_telefone,3);
      end if;
      if v_doc_tipo is null or v_doc_tipo not in ('cpf','cnpj')
         or v_telefone !~ '^[1-9][0-9]9[0-9]{8} is null
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
  if new.raw_user_meta_data ? 'qf_documento_cadastro' then
    update auth.users
      set raw_user_meta_data=raw_user_meta_data-'qf_documento_cadastro'-'qf_documento_tipo_cadastro'-'qf_cadastro_exploracao'
      where id=new.id;
  end if;
  return new;
end;
$function$;
 then
        raise exception 'CPF, CNPJ ou telefone inválido' using errcode='P0001';
      end if;
      perform pg_advisory_xact_lock(hashtextextended('qf_cadastro_exploracao:' || v_telefone,0));
      v_identidade := public.qf_pre_cadastro_documento_elegivel(
        v_doc_tipo,new.raw_user_meta_data->>'qf_documento_cadastro',v_telefone
      );
      if not coalesce((v_identidade->>'ok')::boolean,false)
         or not coalesce((public.qf_pre_cadastro_telefone_elegivel(v_telefone)->>'ok')::boolean,false) then
        raise exception 'Identidade indisponível para cadastro' using errcode='P0001';
      end if;
      insert into private.qf_identidades(user_id,cpf_hash,cpf_last4,cnpj_hash,cnpj_last4,atualizado_em)
      values(new.id,
        case when v_doc_tipo='cpf' then v_identidade->>'documento_hash' end,
        case when v_doc_tipo='cpf' then v_identidade->>'documento_final' end,
        case when v_doc_tipo='cnpj' then v_identidade->>'documento_hash' end,
        case when v_doc_tipo='cnpj' then v_identidade->>'documento_final' end,
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
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION qf_private.conceder_bonus_lancamento_profissional()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows integer := 0;
  v_cfg jsonb := (select c.valor from public.qf_config c where c.chave = 'bonus_cadastro');
  v_ativo boolean := coalesce((v_cfg->>'ativo')::boolean, false);
  v_valor integer := least(greatest(coalesce((v_cfg->>'valor_centavos')::integer, 0), 0), 10000);
begin
  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(new.user_id,0,0,true)
  on conflict(profissional_id) do update
  set bonus_inicial_usado=true;

  -- V11.48: bônus desligado (ou valor zero) no painel: cria só a carteira, sem crédito.
  if not v_ativo or v_valor <= 0 or exists (
    select 1 from private.qf_cadastros_exploracao where user_id=new.user_id
  ) then
    return new;
  end if;

  insert into public.qf_movimentacoes_carteira(
    profissional_id,tipo,valor_centavos,referencia_tipo,descricao
  )
  values(
    new.user_id,'bonus',v_valor,'bonus_lancamento',
    'Bônus de cadastro QuemFaz — R$ ' || replace(to_char(v_valor / 100.0, 'FM999990.00'), '.', ',')
  )
  on conflict do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 1 then
    update public.qf_carteiras
       set saldo_centavos=saldo_centavos+v_valor,
           atualizado_em=now()
     where profissional_id=new.user_id;
  end if;

  return new;
end;
$function$;

-- Uma confirmação de recarga é necessária antes do primeiro desbloqueio.
-- O RPC atual continua responsável por verificar e debitar o saldo ou cota.
create function private.qf_exigir_recarga_exploracao()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if exists(select 1 from private.qf_cadastros_exploracao where user_id=new.profissional_id)
     and not exists (
       select 1 from public.qf_recargas
       where profissional_id=new.profissional_id and status='aprovado'
         and valor_centavos>0 and provedor='efi' and nullif(provedor_id,'') is not null
     ) then
    raise exception 'Adicione saldo à carteira para desbloquear o pedido.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.qf_exigir_recarga_exploracao() from public, anon, authenticated;
create trigger qf_exigir_recarga_exploracao before insert on public.qf_desbloqueios
for each row execute function private.qf_exigir_recarga_exploracao();

-- Um orçamento direto não pode contornar o desbloqueio para essas contas.
create function private.qf_exigir_desbloqueio_exploracao()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if exists(select 1 from private.qf_cadastros_exploracao where user_id=new.profissional_id)
     and not exists (
       select 1 from public.qf_desbloqueios
       where profissional_id=new.profissional_id and chamado_id=new.chamado_id and coalesce(ativo,true)
     ) then
    raise exception 'Desbloqueie o pedido antes de enviar um orçamento.' using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.qf_exigir_desbloqueio_exploracao() from public, anon, authenticated;
create trigger qf_exigir_desbloqueio_exploracao before insert or update of chamado_id, profissional_id on public.qf_orcamentos
for each row execute function private.qf_exigir_desbloqueio_exploracao();
