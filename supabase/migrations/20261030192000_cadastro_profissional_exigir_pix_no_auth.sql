-- Etapa de endurecimento do cadastro de novos profissionais.
-- BACKUP: backup/antes-planos-sem-comissao-20261030
-- Somente publicar junto com frontend e Edge Function compatíveis.
-- Não apaga benefício legado nem altera assinatura já paga.
-- Bloqueia criação automática de perfis de profissional sem Pix Efí liquidado.
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
         (v_pago.plano='basico' and v_pago.valor_centavos=3990) or
         (v_pago.plano='pro_v2' and v_pago.valor_centavos=7990) or
         (v_pago.plano='completo' and v_pago.valor_centavos=14990)
       )
    then
      raise exception 'É necessário pagar o plano escolhido para concluir seu cadastro.'
        using errcode='P0001';
    end if;
    -- Um pagamento só pode ser vinculado a uma identidade.
    insert into private.qf_cadastro_pagamento_vinculo(user_id,pagamento_id)
      values(new.id,v_pago.id);
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

-- Benefício gratuito antigo não é comprovante de pagamento de cadastro.
create or replace function private.qf_cadastro_profissional_pago(p_uid uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select private.qf_cadastro_pagamento_original_ok(p_uid)
$$;

-- Desabilita criação de novos testes gratuitos pela API pública.
-- Histórico de benefícios e profissionais já existentes permanece intacto.
revoke all on function public.qf_livre_preparar_acesso(boolean,text,text)
from public, anon, authenticated;
