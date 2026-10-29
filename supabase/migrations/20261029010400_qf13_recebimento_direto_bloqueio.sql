-- Declaração explícita de recebimento direto pelo profissional do Plano Livre.
-- O sistema não consegue detectar sozinho um pagamento feito fora da plataforma.
ALTER TABLE public.qf_comissao13_fechamentos
  ADD COLUMN IF NOT EXISTS recebimento_direto_declarado_em timestamptz;
CREATE INDEX IF NOT EXISTS qf13_direto_pendente_prof_idx
  ON public.qf_comissao13_fechamentos(profissional_id,recebimento_direto_declarado_em)
  WHERE status='confirmado' AND cobranca_status='pendente';

CREATE OR REPLACE FUNCTION public.qf_comissao13_declarar_recebimento_direto(p_fechamento_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE f public.qf_comissao13_fechamentos; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','nao_autenticado'); END IF;
  SELECT * INTO f FROM public.qf_comissao13_fechamentos
   WHERE id=p_fechamento_id AND profissional_id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','sem_permissao'); END IF;
  IF f.recebimento_direto_declarado_em IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'duplicado',true,'bloqueado_ate_quitacao',f.cobranca_status<>'paga');
  END IF;
  IF f.status<>'confirmado' OR f.cliente_resposta IS DISTINCT FROM 'confirmado'
     OR f.cliente_concluiu_em IS NULL OR f.cobranca_status<>'pendente'
     OR f.comissao_centavos IS NULL OR f.comissao_centavos<=0 THEN
    RETURN jsonb_build_object('ok',false,'reason','conclusao_ou_cobranca_nao_confirmada');
  END IF;
  -- Previne dupla cobrança caso a plataforma já tenha recebido valor do serviço.
  IF EXISTS (
    SELECT 1 FROM public.qf_comissao13_financeiro x
    JOIN public.qf_comissao13_acordos a ON a.id=x.acordo_id
    WHERE a.chamado_id=f.chamado_id AND a.profissional_id=v_uid
      AND (x.status='pago' OR x.pago_em IS NOT NULL)
  ) OR EXISTS (
    SELECT 1 FROM private.qf_livre_split_pagamentos x
    WHERE x.chamado_id=f.chamado_id AND x.profissional_id=v_uid
      AND (x.status IN ('pago','repassado') OR x.confirmado_em IS NOT NULL)
  ) THEN RETURN jsonb_build_object('ok',false,'reason','pagamento_plataforma_ja_confirmado'); END IF;
  UPDATE public.qf_comissao13_fechamentos
    SET recebimento_direto_declarado_em=now(),
        comissao_vence_em=now()
    WHERE id=f.id;
  INSERT INTO public.qf_pagamento_eventos(tabela,referencia_id,profissional_id,evento,detalhe)
    VALUES ('qf_comissao13_fechamentos',f.id,v_uid,'recebimento_direto_declarado',
      jsonb_build_object('comissao_centavos',f.comissao_centavos,'bloqueio_ate_pix_conciliado',true));
  RETURN jsonb_build_object('ok',true,'bloqueado_ate_quitacao',true,'comissao_centavos',f.comissao_centavos);
END $$;
REVOKE EXECUTE ON FUNCTION public.qf_comissao13_declarar_recebimento_direto(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_comissao13_declarar_recebimento_direto(uuid) TO authenticated;

-- Desbloqueio imediatamente suspenso quando o próprio profissional confirma
-- recebimento direto e ainda não quitou a comissão por Pix confirmado pelo banco.
CREATE OR REPLACE FUNCTION private.qf13_bloqueio(p_prof uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM public.qf_comissao13_fechamentos f
  WHERE f.profissional_id=p_prof AND f.status='confirmado'
    AND f.cobranca_status='pendente'
    AND (f.comissao_vence_em<=now() OR f.recebimento_direto_declarado_em IS NOT NULL)
) THEN 'comissao_pendente' ELSE NULL END
$$;
REVOKE EXECUTE ON FUNCTION private.qf13_bloqueio(uuid) FROM PUBLIC,anon,authenticated;
