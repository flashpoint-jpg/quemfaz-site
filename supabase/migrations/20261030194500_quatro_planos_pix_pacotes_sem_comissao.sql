-- Quem Faz: quatro planos, cadastro obrigatoriamente pago, preservação de planos antigos.
-- Cada contrato antigo permanece no catálogo antigo; novos IDs não substituem preços já contratados.
-- Execução requer deploy conjunto da Edge Function e frontend da mesma release.
alter table public.qf_planos_catalogo drop constraint if exists qf_planos_catalogo_plano_check;
alter table public.qf_planos_catalogo add constraint qf_planos_catalogo_plano_check
 check(plano in ('mensal','pro','premium','avulso','livre','basico_v2','pro_v2','completo_v2'));
alter table public.qf_recargas drop constraint if exists qf_recargas_plano_check;
alter table public.qf_recargas add constraint qf_recargas_plano_check
 check(plano in ('mensal','pro','premium','livre','basico_v2','pro_v2','completo_v2'));
alter table public.qf_planos_profissional drop constraint if exists qf_planos_profissional_plano_check;
alter table public.qf_planos_profissional add constraint qf_planos_profissional_plano_check
 check(plano in ('mensal','pro','premium','basico_v2','pro_v2','completo_v2'));
insert into public.qf_planos_catalogo(plano,nome,preco_centavos,chamados,dias,ativo)
values('basico_v2','Básico',3990,10,30,true),
      ('pro_v2','Pro',7990,25,30,true),
      ('completo_v2','Mensal completo',14990,100,30,true)
on conflict(plano) do update
set nome=excluded.nome,preco_centavos=excluded.preco_centavos,
chamados=excluded.chamados,dias=excluded.dias,ativo=true;
-- Pacotes antigos e suas cotas/expirações NÃO são modificados.
create or replace function private.qf_ativar_pacote_v2(p_recarga uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare r public.qf_recargas; esperado integer; quantidade integer;
begin
 select * into r from public.qf_recargas where id=p_recarga for update;
 if not found then return 'nao_encontrada'; end if;
 if r.plano not in ('basico_v2','pro_v2','completo_v2')
 then return 'plano_invalido'; end if;
 esperado:=case r.plano when 'basico_v2' then 3990 when 'pro_v2' then 7990 else 14990 end;
 quantidade:=case r.plano when 'basico_v2' then 10 when 'pro_v2' then 25 else 100 end;
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
end $$;
CREATE OR REPLACE FUNCTION public.qf_recarga_pagamento_aplicado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='aprovado' and old.status is distinct from 'aprovado' then
  if new.plano in ('basico_v2','pro_v2','completo_v2') then
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
end $function$
;
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
     AND ((p.plano='avulso' AND p.valor_centavos=1300)
       OR (p.plano='livre' AND p.valor_centavos=3990 AND p.metodo='pix')
       OR (p.plano='basico_v2' AND p.valor_centavos=3990 AND p.metodo='pix')
       OR (p.plano='pro_v2' AND p.valor_centavos=7990 AND p.metodo='pix')
       OR (p.plano='completo_v2' AND p.valor_centavos=14990 AND p.metodo='pix'))
 );
$function$
;
CREATE OR REPLACE FUNCTION public.qf_vincular_pre_cadastro(p_id uuid, p_segredo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_email text; v_pago public.qf_pre_cadastro_pagamentos;
        v_usuario uuid; v_pagamento uuid;
BEGIN
 IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
 SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id=v_uid AND email_confirmed_at IS NOT NULL;
 IF v_email IS NULL THEN RETURN jsonb_build_object('ok',false,'error','email_nao_confirmado'); END IF;
 IF p_id IS NULL OR length(coalesce(p_segredo,'')) < 20 THEN RETURN jsonb_build_object('ok',false,'error','identificacao_invalida'); END IF;
 SELECT * INTO v_pago FROM public.qf_pre_cadastro_pagamentos
  WHERE id=p_id AND segredo=p_segredo FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','pagamento_nao_encontrado'); END IF;
 IF v_email IS DISTINCT FROM lower(trim(v_pago.email)) THEN RETURN jsonb_build_object('ok',false,'error','email_divergente'); END IF;
 IF v_pago.status <> 'aprovado' OR v_pago.provedor <> 'efi' OR nullif(v_pago.provedor_id,'') IS NULL
    OR NOT ((v_pago.plano='avulso' AND v_pago.valor_centavos=1300)
        OR (v_pago.plano='livre' AND v_pago.valor_centavos=3990 AND v_pago.metodo='pix')
        OR (v_pago.plano='basico_v2' AND v_pago.valor_centavos=3990 AND v_pago.metodo='pix')
        OR (v_pago.plano='pro_v2' AND v_pago.valor_centavos=7990 AND v_pago.metodo='pix')
        OR (v_pago.plano='completo_v2' AND v_pago.valor_centavos=14990 AND v_pago.metodo='pix')) THEN
   RETURN jsonb_build_object('ok',false,'error','pagamento_nao_validado');
 END IF;
 IF v_pago.profissional_id IS NOT NULL AND v_pago.profissional_id<>v_uid THEN
   RETURN jsonb_build_object('ok',false,'error','pagamento_ja_usado');
 END IF;
 IF EXISTS(SELECT 1 FROM public.qf_profiles WHERE id=v_uid AND tipo<>'profissional') THEN
   RETURN jsonb_build_object('ok',false,'error','conta_de_outro_tipo');
 END IF;
 INSERT INTO private.qf_cadastro_pagamento_vinculo(user_id,pagamento_id)
 VALUES(v_uid,p_id)
 ON CONFLICT DO NOTHING;
 SELECT pagamento_id INTO v_pagamento FROM private.qf_cadastro_pagamento_vinculo WHERE user_id=v_uid;
 SELECT user_id INTO v_usuario FROM private.qf_cadastro_pagamento_vinculo WHERE pagamento_id=p_id;
 IF v_pagamento IS DISTINCT FROM p_id OR v_usuario IS DISTINCT FROM v_uid THEN
   RETURN jsonb_build_object('ok',false,'error','pagamento_ja_vinculado');
 END IF;
 RETURN jsonb_build_object('ok',true,'plano',v_pago.plano);
END $function$
;
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
 IF r.plano IN ('avulso','livre','basico_v2','pro_v2','completo_v2') THEN
   SELECT pagamento_id INTO v_vinculo FROM private.qf_cadastro_pagamento_vinculo WHERE user_id=v_uid;
   IF v_vinculo IS DISTINCT FROM r.id OR
      NOT ((r.plano='avulso' AND r.valor_centavos=1300)
        OR (r.plano='livre' AND r.valor_centavos=3990 AND r.metodo='pix')
        OR (r.plano='basico_v2' AND r.valor_centavos=3990 AND r.metodo='pix')
        OR (r.plano='pro_v2' AND r.valor_centavos=7990 AND r.metodo='pix')
        OR (r.plano='completo_v2' AND r.valor_centavos=14990 AND r.metodo='pix')) THEN
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
 IF r.plano IN ('basico_v2','pro_v2','completo_v2') AND NOT EXISTS(
   SELECT 1 FROM public.qf_planos_profissional pp
   WHERE pp.recarga_id=v_rec AND pp.profissional_id=v_uid
     AND pp.chamados_restantes>0 AND pp.valido_ate>now()
 ) THEN
   RAISE EXCEPTION 'Pagamento mensal sem ativação do pacote';
 END IF;
 IF r.plano='avulso' AND NOT EXISTS(
   SELECT 1 FROM public.qf_movimentacoes_carteira m
   WHERE m.profissional_id=v_uid AND m.referencia_tipo='recarga'
   AND m.referencia_id=v_rec AND m.tipo='credito' AND m.valor_centavos=1300
 ) THEN
   RAISE EXCEPTION 'Falha ao creditar a recarga inicial';
 END IF;
 UPDATE public.qf_pre_cadastro_pagamentos
  SET profissional_id=v_uid,recarga_id=v_rec,resgatado_em=now()
  WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'plano',r.plano,'recarga_id',v_rec,'valor_centavos',r.valor_centavos);
END $function$
;
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
  if p_plano not in ('basico_v2','pro_v2','completo_v2') then raise exception 'Plano substituído; escolha Básico, Pro ou Completo'; end if;
  select * into c from public.qf_planos_catalogo where plano = p_plano and ativo;
  if c.plano is null then raise exception 'invalid plan'; end if;
  insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, plano)
  values (v_uid, c.preco_centavos, p_metodo, 'pendente', c.plano)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'recarga_id', v_id, 'status', 'pendente', 'valor_centavos', c.preco_centavos,
                            'metodo', p_metodo, 'plano', c.plano, 'chamados', c.chamados, 'dias', c.dias);
end $function$
;
-- A nova contratação e consumo de pacote não geram cobrança de comissão.
-- Preserva histórico anterior, código de contratação e contestações antigas.
update private.qf_comissao13_config set ativo=false,atualizado_em=now() where id=true;

-- Plano Livre com comissão não pode mais ser vendido a novos assinantes.
-- As assinaturas antigas permanecem válidas até a expiração.
create or replace function private.qf_livre_solicitar_pix()
returns jsonb language sql security definer set search_path to ''
as $$ select jsonb_build_object('ok',false,'reason','plano_substituido',
'message','O plano Livre foi substituído. Escolha Básico, Pro ou Mensal completo.') $$;
-- Não registrar novas adesões a uma modalidade remunerada por comissão.
create or replace function public.qf_comissao13_aderir(p_aceitar boolean)
returns jsonb language sql security definer set search_path to ''
as $$ select jsonb_build_object('ok',false,'reason','modalidade_encerrada',
'message','A modalidade com comissão foi encerrada. Escolha um plano sem comissão.') $$;
