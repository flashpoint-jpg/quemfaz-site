-- QUEM FAZ: cadastro profissional somente após pagamento bancário (Avulso R$13 ou Livre R$39,90).
-- Migração de implantação coordenada: publicar frontend compatível antes de ativar a proteção.
-- Não executa transações bancárias, não altera profissionais existentes nem ativa repasses.
BEGIN;

-- Preserve o catálogo legado para renovações/histórico; novas adesões usarão somente estas duas opções.
ALTER TABLE public.qf_planos_catalogo DROP CONSTRAINT IF EXISTS qf_planos_catalogo_plano_check;
ALTER TABLE public.qf_planos_catalogo ADD CONSTRAINT qf_planos_catalogo_plano_check
  CHECK (plano IN ('mensal','pro','premium','avulso','livre'));
INSERT INTO public.qf_planos_catalogo(plano,nome,preco_centavos,chamados,dias,ativo)
VALUES ('avulso','Avulso — recarga inicial',1300,1,30,true),
       ('livre','Quem Faz Livre',3990,1,30,true)
ON CONFLICT (plano) DO UPDATE SET
 nome=EXCLUDED.nome,preco_centavos=EXCLUDED.preco_centavos,ativo=true;
-- Impede que um preço divergente seja cobrado e nunca possa habilitar a conta.
ALTER TABLE public.qf_planos_catalogo
 ADD CONSTRAINT qf_cadastro_preco_valido CHECK (
   (plano <> 'avulso' OR preco_centavos = 1300)
   AND (plano <> 'livre' OR preco_centavos = 3990)
 );

-- OBS: "chamados" e "dias" em Avulso são valores técnicos para o catálogo legado;
-- o resgate Avulso grava plano=NULL na recarga e credita 1300 centavos, sem pacote/validade.

CREATE TABLE IF NOT EXISTS private.qf_profissionais_anteriores_pagamento (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 preservado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.qf_profissionais_anteriores_pagamento(user_id)
 SELECT id FROM public.qf_profiles WHERE tipo='profissional'
 UNION SELECT user_id FROM public.qf_profissionais
ON CONFLICT DO NOTHING;
REVOKE ALL ON private.qf_profissionais_anteriores_pagamento FROM PUBLIC,anon,authenticated;

CREATE TABLE IF NOT EXISTS private.qf_cadastro_pagamento_vinculo (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 pagamento_id uuid NOT NULL UNIQUE REFERENCES public.qf_pre_cadastro_pagamentos(id) ON DELETE RESTRICT,
 vinculado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.qf_cadastro_pagamento_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.qf_cadastro_pagamento_vinculo FROM PUBLIC,anon,authenticated;

-- O navegador só apresenta ID e segredo; o servidor valida identidade, banco e valor.
CREATE OR REPLACE FUNCTION public.qf_vincular_pre_cadastro(p_id uuid, p_segredo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
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
        OR (v_pago.plano='livre' AND v_pago.valor_centavos=3990 AND v_pago.metodo='pix')) THEN
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
END $$;
REVOKE ALL ON FUNCTION public.qf_vincular_pre_cadastro(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_vincular_pre_cadastro(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.qf_cadastro_profissional_pago(p_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
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
       OR (p.plano='livre' AND p.valor_centavos=3990 AND p.metodo='pix'))
 );
$$;
REVOKE ALL ON FUNCTION private.qf_cadastro_profissional_pago(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.qf_exigir_pagamento_perfil_profissional()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
 IF NEW.tipo='profissional'
    AND (TG_OP='INSERT' OR OLD.tipo IS DISTINCT FROM 'profissional')
    AND NOT private.qf_cadastro_profissional_pago(NEW.id) THEN
   RAISE EXCEPTION 'Pagamento inicial ainda não confirmado' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_qf_cadastro_profissional_pago_perfil ON public.qf_profiles;
CREATE TRIGGER trg_qf_cadastro_profissional_pago_perfil
 BEFORE INSERT OR UPDATE OF tipo ON public.qf_profiles
 FOR EACH ROW EXECUTE FUNCTION private.qf_exigir_pagamento_perfil_profissional();

CREATE OR REPLACE FUNCTION private.qf_exigir_pagamento_profissional()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
 IF NOT private.qf_cadastro_profissional_pago(NEW.user_id) THEN
   RAISE EXCEPTION 'Pagamento inicial ainda não confirmado' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_qf_cadastro_profissional_pago ON public.qf_profissionais;
CREATE TRIGGER trg_qf_cadastro_profissional_pago
 BEFORE INSERT ON public.qf_profissionais
 FOR EACH ROW EXECUTE FUNCTION private.qf_exigir_pagamento_profissional();

-- Resgate idempotente e transacional. Cartão Avulso pode ser aceito; Livre inicial somente Pix.
-- Pagamento de R$ 13 vira recarga normal (plano nulo): 100% de crédito, não mensalidade.
CREATE OR REPLACE FUNCTION public.qf_resgatar_pre_cadastro(p_id uuid,p_segredo text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
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
 IF r.plano IN ('avulso','livre') THEN
   SELECT pagamento_id INTO v_vinculo FROM private.qf_cadastro_pagamento_vinculo WHERE user_id=v_uid;
   IF v_vinculo IS DISTINCT FROM r.id OR
      NOT ((r.plano='avulso' AND r.valor_centavos=1300)
        OR (r.plano='livre' AND r.valor_centavos=3990 AND r.metodo='pix')) THEN
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
   AND m.referencia_id=v_rec AND m.tipo='credito' AND m.valor_centavos=1300
 ) THEN
   RAISE EXCEPTION 'Falha ao creditar a recarga inicial';
 END IF;
 UPDATE public.qf_pre_cadastro_pagamentos
  SET profissional_id=v_uid,recarga_id=v_rec,resgatado_em=now()
  WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'plano',r.plano,'recarga_id',v_rec,'valor_centavos',r.valor_centavos);
END $$;
REVOKE ALL ON FUNCTION public.qf_resgatar_pre_cadastro(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_resgatar_pre_cadastro(uuid,text) TO authenticated;
COMMIT;
