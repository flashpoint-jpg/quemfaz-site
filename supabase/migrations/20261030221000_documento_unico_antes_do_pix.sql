-- Antifraude: um CPF/CNPJ por profissional, validado antes do Pix.
-- Em produção existem cadastros legados sem identidade: preservar seus direitos.
-- O documento em claro NÃO é armazenado. Guardar apenas SHA-256 e últimos 4.
alter table public.qf_pre_cadastro_pagamentos
  add column if not exists documento_tipo text,
  add column if not exists documento_hash text,
  add column if not exists documento_final char(4);

alter table public.qf_pre_cadastro_pagamentos
  drop constraint if exists qf_pre_cadastro_documento_consistente;
alter table public.qf_pre_cadastro_pagamentos
  add constraint qf_pre_cadastro_documento_consistente
    check (documento_hash is null or
       (documento_tipo in ('cpf','cnpj') and
        documento_hash ~ '^[a-f0-9]{64}$' and
        documento_final ~ '^[A-Z0-9]{4}$'));

create unique index if not exists qf_pre_cadastro_um_documento_por_pagamento_ativo
  on public.qf_pre_cadastro_pagamentos(documento_hash)
  where documento_hash is not null and status in ('pendente','aprovado');

-- Exclusivo da Edge Function com service_role. Resposta NÃO revela identidade.
create or replace function public.qf_pre_cadastro_documento_elegivel(
  p_tipo text,p_documento text,p_telefone text
)
returns jsonb language plpgsql stable security definer
set search_path to ''
as $fn$
declare
 v_doc text;
 v_hash text;
 v_tel text;
begin
 if p_tipo not in ('cpf','cnpj') then
   return jsonb_build_object('ok',false,'error','tipo_documento_invalido');
 end if;
 v_doc:=case when p_tipo='cpf'
   then regexp_replace(coalesce(p_documento,''),'[^0-9]','','g')
   else upper(regexp_replace(coalesce(p_documento,''),'[^A-Za-z0-9]','','g'))
 end;
 if not (case when p_tipo='cpf'
   then private.qf_cpf_valido(v_doc)
   else private.qf_cnpj_valido(v_doc) end)
 then return jsonb_build_object('ok',false,'error','documento_invalido'); end if;
 v_hash:=encode(extensions.digest(v_doc,'sha256'),'hex');
 v_tel:=regexp_replace(coalesce(p_telefone,''),'[^0-9]','','g');
 if left(v_tel,2)='55' and length(v_tel) in (12,13)
 then v_tel:=substr(v_tel,3); end if;
 if length(v_tel) not in (10,11)
 then return jsonb_build_object('ok',false,'error','telefone_invalido'); end if;

 if exists(select 1 from private.qf_identidades i
   where (p_tipo='cpf' and i.cpf_hash=v_hash)
   or (p_tipo='cnpj' and i.cnpj_hash=v_hash))
 then return jsonb_build_object('ok',false,'error','documento_ja_cadastrado'); end if;

 if exists(select 1 from public.qf_pre_cadastro_pagamentos x
  where x.documento_hash=v_hash and x.status in('pendente','aprovado'))
 then return jsonb_build_object('ok',false,'error','documento_cobranca_existente'); end if;

 -- Proteção adicional dos legados ainda sem CPF/CNPJ associado.
 -- Mesmo telefone não prova identidade; encaminhar para login/suporte, sem Pix.
 if exists(
  select 1 from public.qf_profiles p
   where p.tipo='profissional'
   and (case when length(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g')) in (12,13)
                 and left(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g'),2)='55'
         then substr(regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g'),3)
         else regexp_replace(coalesce(p.telefone,''),'[^0-9]','','g') end)=v_tel
 ) then return jsonb_build_object('ok',false,'error','telefone_ja_cadastrado'); end if;

 return jsonb_build_object('ok',true,'documento_hash',v_hash,
  'documento_final',right(v_doc,4),'documento_tipo',p_tipo);
end;
$fn$;
revoke all on function public.qf_pre_cadastro_documento_elegivel(text,text,text)
from public,anon,authenticated;
grant execute on function public.qf_pre_cadastro_documento_elegivel(text,text,text)
to service_role;

-- O trigger do Auth vincula o hash de documento do pagamento à identidade
-- na MESMA transação que cria a conta, preservando o índice único existente.
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
begin
  v_role := coalesce(new.raw_user_meta_data ->> 'qf_role', 'cliente');
  if v_role not in ('cliente','profissional') then
    v_role := 'cliente';
  end if;
  -- A escolha "profissional" vinda do cliente nunca concede acesso por si so.
  -- O comprovante é apenas uma referência: o banco valida valor, titularidade,
  -- situação da cobrança e unicidade de utilização ANTES de criar o perfil.
  if v_role = 'profissional' then
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
         (v_pago.plano='avulso' and v_pago.valor_centavos=1300) or
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

  return new;
end;
$function$
;
