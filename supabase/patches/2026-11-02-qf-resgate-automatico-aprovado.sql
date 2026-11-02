-- PROPOSTA PARA HOMOLOGACAO, NAO APLICAR EM PRODUCAO SEM AUTORIZACAO.
-- Idempotencia e transacao unica para resgate de pagamento da Efi validado pelo servidor.
CREATE TABLE IF NOT EXISTS private.qf_pre_cadastro_resgate_estado (
 pagamento_id uuid PRIMARY KEY REFERENCES public.qf_pre_cadastro_pagamentos(id) ON DELETE CASCADE,
 estado text NOT NULL CHECK(estado IN ('aguardando_identificacao','resgatado')),
 motivo text,
 atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.qf_pre_cadastro_resgate_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.qf_pre_cadastro_resgate_estado FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.qf_auto_resgatar_pre_cadastro(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $auto$
DECLARE r public.qf_pre_cadastro_pagamentos%ROWTYPE; uid uuid;
        rec public.qf_recargas%ROWTYPE; rec_id uuid; n integer;
BEGIN
 IF COALESCE(auth.jwt()->>'role','') <> 'service_role' THEN
   RAISE EXCEPTION 'acesso_negado' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM public.qf_pre_cadastro_pagamentos WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'estado','nao_encontrado'); END IF;
 IF r.status<>'aprovado' OR r.provedor<>'efi' OR NULLIF(r.provedor_id,'') IS NULL
   OR NOT ((r.plano='avulso' AND r.valor_centavos=1499)
    OR (r.plano='basico_v2' AND r.valor_centavos=3990)
    OR (r.plano='pro_v2' AND r.valor_centavos=7990)
    OR (r.plano='completo_v2' AND r.valor_centavos=14990)) THEN
   RETURN jsonb_build_object('ok',false,'estado','pagamento_nao_elegivel');
 END IF;
 IF r.profissional_id IS NOT NULL THEN
   IF r.recarga_id IS NULL OR r.resgatado_em IS NULL THEN
     RAISE EXCEPTION 'resgate_parcial_requer_auditoria';
   END IF;
   SELECT * INTO rec FROM public.qf_recargas WHERE id=r.recarga_id;
   IF NOT FOUND OR rec.profissional_id IS DISTINCT FROM r.profissional_id
     OR rec.valor_centavos<>r.valor_centavos OR rec.status<>'aprovado'
     OR rec.provedor_id IS DISTINCT FROM r.provedor_id THEN
     RAISE EXCEPTION 'recarga_vinculada_inconsistente';
   END IF;
   IF r.plano='avulso' AND NOT EXISTS
     (SELECT 1 FROM public.qf_movimentacoes_carteira m
      WHERE m.profissional_id=r.profissional_id AND m.referencia_tipo='recarga'
        AND m.referencia_id=rec.id AND m.tipo='credito' AND m.valor_centavos=1499) THEN
     RAISE EXCEPTION 'credito_1499_ausente';
   END IF;
   INSERT INTO private.qf_pre_cadastro_resgate_estado(pagamento_id,estado,motivo)
     VALUES(r.id,'resgatado',NULL)
     ON CONFLICT(pagamento_id) DO UPDATE SET estado='resgatado',motivo=NULL,atualizado_em=now();
   RETURN jsonb_build_object('ok',true,'estado','resgatado','ja_resgatado',true);
 END IF;

 -- Email confirmado SOZINHO nao basta. Exige vinculo criado via segredo + perfil ja existente.
 SELECT v.user_id INTO uid
 FROM private.qf_cadastro_pagamento_vinculo v
 JOIN auth.users u ON u.id=v.user_id AND u.email_confirmed_at IS NOT NULL
 JOIN public.qf_profiles p ON p.id=u.id AND p.tipo='profissional'
 JOIN public.qf_profissionais pro ON pro.user_id=u.id
 WHERE v.pagamento_id=r.id AND lower(trim(u.email))=lower(trim(r.email))
 FOR UPDATE OF v;
 IF uid IS NULL THEN
   INSERT INTO private.qf_pre_cadastro_resgate_estado(pagamento_id,estado,motivo)
    VALUES(r.id,'aguardando_identificacao','conta_ou_vinculo_pendente')
    ON CONFLICT(pagamento_id) DO UPDATE
     SET estado='aguardando_identificacao',motivo='conta_ou_vinculo_pendente',atualizado_em=now();
   RETURN jsonb_build_object('ok',true,'estado','aguardando_identificacao');
 END IF;

 SELECT * INTO rec FROM public.qf_recargas WHERE provedor_id=r.provedor_id FOR UPDATE;
 IF FOUND THEN
   IF rec.profissional_id IS DISTINCT FROM uid OR rec.valor_centavos<>r.valor_centavos
     OR rec.provedor<>'efi' OR rec.metodo IS DISTINCT FROM r.metodo
     OR (r.plano='avulso' AND rec.plano IS NOT NULL)
     OR (r.plano<>'avulso' AND rec.plano IS DISTINCT FROM r.plano)
     OR rec.status NOT IN ('pendente','aprovado') THEN
      RAISE EXCEPTION 'recarga_existente_invalida';
   END IF;
   rec_id:=rec.id;
 ELSE
   INSERT INTO public.qf_recargas
     (profissional_id,valor_centavos,metodo,status,provedor,provedor_id,plano)
   VALUES(uid,r.valor_centavos,r.metodo,'pendente','efi',r.provedor_id,
       CASE WHEN r.plano='avulso' THEN NULL ELSE r.plano END)
   ON CONFLICT DO NOTHING RETURNING id INTO rec_id;
   IF rec_id IS NULL THEN RAISE EXCEPTION 'conflito_recarga_concorrente'; END IF;
 END IF;
 UPDATE public.qf_recargas SET status='aprovado' WHERE id=rec_id AND status='pendente';
 IF NOT EXISTS(SELECT 1 FROM public.qf_recargas WHERE id=rec_id AND status='aprovado') THEN
    RAISE EXCEPTION 'recarga_nao_aprovada';
 END IF;
 IF r.plano='avulso' THEN
   SELECT count(*) INTO n FROM public.qf_movimentacoes_carteira m
     WHERE m.profissional_id=uid AND m.referencia_tipo='recarga'
       AND m.referencia_id=rec_id AND m.tipo='credito' AND m.valor_centavos=1499;
   IF n<>1 THEN RAISE EXCEPTION 'credito_1499_nao_lancado_ou_duplicado'; END IF;
 END IF;
 UPDATE public.qf_pre_cadastro_pagamentos
   SET profissional_id=uid,recarga_id=rec_id,resgatado_em=now()
   WHERE id=r.id AND profissional_id IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'conflito_de_resgate'; END IF;
 INSERT INTO private.qf_pre_cadastro_resgate_estado(pagamento_id,estado,motivo)
   VALUES(r.id,'resgatado',NULL)
   ON CONFLICT(pagamento_id) DO UPDATE SET estado='resgatado',motivo=NULL,atualizado_em=now();
 RETURN jsonb_build_object('ok',true,'estado','resgatado','profissional_id',uid,'recarga_id',rec_id);
END $auto$;
REVOKE ALL ON FUNCTION public.qf_auto_resgatar_pre_cadastro(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.qf_auto_resgatar_pre_cadastro(uuid) TO service_role;
