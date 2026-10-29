-- Administração pode registrar pagamento direto após conferir a declaração do cliente.
CREATE OR REPLACE FUNCTION public.qf_comissao13_admin_declarar_direto(
 p_fechamento_id uuid, p_evidencia text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE f public.qf_comissao13_fechamentos; v_uid uuid := auth.uid();
BEGIN
 IF v_uid IS NULL OR NOT private.qf_is_admin() THEN
   RETURN jsonb_build_object('ok',false,'reason','sem_permissao'); END IF;
 IF length(trim(coalesce(p_evidencia,'')))<20 OR length(p_evidencia)>2000 THEN
   RETURN jsonb_build_object('ok',false,'reason','evidencia_obrigatoria'); END IF;
 SELECT * INTO f FROM public.qf_comissao13_fechamentos WHERE id=p_fechamento_id FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','nao_encontrado'); END IF;
 IF f.recebimento_direto_declarado_em IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'duplicado',true); END IF;
 IF f.status<>'confirmado' OR f.cliente_concluiu_em IS NULL OR f.cobranca_status<>'pendente'
    OR f.comissao_centavos IS NULL OR f.comissao_centavos<=0 THEN
   RETURN jsonb_build_object('ok',false,'reason','fechamento_nao_confirmado'); END IF;
 IF EXISTS(
  SELECT 1 FROM public.qf_comissao13_financeiro x
  JOIN public.qf_comissao13_acordos a ON a.id=x.acordo_id
  WHERE a.chamado_id=f.chamado_id AND a.profissional_id=f.profissional_id
    AND x.status IN ('criando','pendente','incerto','pago')
 ) OR EXISTS(
  SELECT 1 FROM private.qf_livre_split_pagamentos x
  WHERE x.chamado_id=f.chamado_id AND x.profissional_id=f.profissional_id
    AND x.status IN ('preparando','pix_pronto','pago','repassado')
 ) THEN RETURN jsonb_build_object('ok',false,'reason','cobranca_plataforma_existe'); END IF;
 UPDATE public.qf_comissao13_fechamentos
 SET recebimento_direto_declarado_em=now(),comissao_vence_em=now(),
 observacao_admin=left(concat_ws(' | ',observacao_admin,'Direto: ',trim(p_evidencia)),2000)
 WHERE id=f.id;
 INSERT INTO public.qf_pagamento_eventos(tabela,referencia_id,profissional_id,evento,detalhe)
 VALUES('qf_comissao13_fechamentos',f.id,f.profissional_id,'recebimento_direto_verificado_admin',
 jsonb_build_object('ator',v_uid,'evidencia',left(p_evidencia,2000),'comissao_centavos',f.comissao_centavos));
 RETURN jsonb_build_object('ok',true,'bloqueado_ate_quitacao',true);
END $$;
REVOKE EXECUTE ON FUNCTION public.qf_comissao13_admin_declarar_direto(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_comissao13_admin_declarar_direto(uuid,text) TO authenticated;
