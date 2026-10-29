-- Corrige o cadastro inicial do profissional sem transformar teste em assinatura paga.
-- O trigger de auth.users cria o esqueleto do perfil ANTES da RPC que verifica
-- pagamento aprovado ou autoriza os 2 dias gratuitos. Bloquear esse bootstrap
-- com "Pagamento inicial ainda nao confirmado" devolvia HTTP 500 no signup.
-- O cadastro em auth nao concede qualquer desbloqueio, credito ou assinatura.
-- Inserts diretos posteriores continuam exigindo pagamento/cortesia legitima.
CREATE OR REPLACE FUNCTION private.qf_exigir_pagamento_perfil_profissional()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF NEW.tipo = 'profissional'
     AND (TG_OP = 'INSERT' OR OLD.tipo IS DISTINCT FROM 'profissional')
     AND pg_trigger_depth() <> 2
     AND NOT private.qf_cadastro_profissional_pago(NEW.id) THEN
    RAISE EXCEPTION 'Pagamento inicial ainda não confirmado' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.qf_exigir_pagamento_profissional()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
BEGIN
  IF pg_trigger_depth() <> 2
     AND NOT private.qf_cadastro_profissional_pago(NEW.user_id) THEN
    RAISE EXCEPTION 'Pagamento inicial ainda não confirmado' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

-- Os benefícios só são ativados na RPC autenticada qf_livre_preparar_acesso,
-- após validação de identidade/uso único, ou após baixa real do Pix.