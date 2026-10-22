
-- Prazo promocional de dez dias, aplicado apenas aos bonus de lancamento/massa.
-- Dinheiro de recargas e creditos pagos permanece sem vencimento.
CREATE TABLE IF NOT EXISTS public.qf_bonus_validade (
  profissional_id uuid PRIMARY KEY REFERENCES public.qf_carteiras(profissional_id) ON DELETE CASCADE,
  saldo_bonus_centavos bigint NOT NULL DEFAULT 0 CHECK (saldo_bonus_centavos >= 0),
  expira_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.qf_bonus_validade ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qf_bonus_validade FROM anon, authenticated;

-- Os creditos existentes passam a ter 10 dias A PARTIR DA ATIVACAO.
-- Para nao consumir recargas pagas, debitos anteriores sao abatidos do bonus primeiro.
WITH transacoes AS (
 SELECT profissional_id,
   coalesce(sum(valor_centavos) FILTER (WHERE tipo='bonus' AND referencia_tipo IN ('bonus_lancamento','bonus_massa')),0) AS bonus_concedido,
   coalesce(sum(valor_centavos) FILTER (WHERE tipo='debito'),0) AS debitos_anteriores
 FROM public.qf_movimentacoes_carteira
 GROUP BY profissional_id
), valores AS (
 SELECT c.profissional_id,
   greatest(0,least(c.saldo_centavos,t.bonus_concedido-t.debitos_anteriores)) AS bonus_restante
 FROM public.qf_carteiras c
 JOIN transacoes t ON t.profissional_id=c.profissional_id
 WHERE t.bonus_concedido > 0
)
INSERT INTO public.qf_bonus_validade(profissional_id,saldo_bonus_centavos,expira_em)
SELECT profissional_id,bonus_restante,now()+interval '10 days'
FROM valores WHERE bonus_restante>0
ON CONFLICT (profissional_id) DO NOTHING;

-- Qualquer debito real na carteira consome primeiro o credito promocional ainda existente.
CREATE OR REPLACE FUNCTION private.qf_bonus_consumir_ao_debitar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.saldo_centavos < OLD.saldo_centavos THEN
    UPDATE public.qf_bonus_validade
       SET saldo_bonus_centavos=greatest(0,saldo_bonus_centavos-(OLD.saldo_centavos-NEW.saldo_centavos)),
           atualizado_em=now()
     WHERE profissional_id=NEW.profissional_id AND saldo_bonus_centavos>0;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS qf_bonus_consumir_ao_debitar ON public.qf_carteiras;
CREATE TRIGGER qf_bonus_consumir_ao_debitar
AFTER UPDATE OF saldo_centavos ON public.qf_carteiras
FOR EACH ROW WHEN (NEW.saldo_centavos < OLD.saldo_centavos)
EXECUTE FUNCTION private.qf_bonus_consumir_ao_debitar();

-- Liquida somente o saldo promocional vencido, nunca o saldo pago.
-- Bloqueia a linha da carteira antes da linha do bonus para manter a mesma ordem de locks.
CREATE OR REPLACE FUNCTION private.qf_expirar_bonus_profissional(p_profissional uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_saldo bigint; v_bonus bigint; v_data timestamptz; v_expira bigint;
BEGIN
  SELECT c.saldo_centavos INTO v_saldo
    FROM public.qf_carteiras c
   WHERE c.profissional_id=p_profissional FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT b.saldo_bonus_centavos,b.expira_em INTO v_bonus,v_data
    FROM public.qf_bonus_validade b
   WHERE b.profissional_id=p_profissional FOR UPDATE;
  IF NOT FOUND OR v_bonus<=0 OR v_data>now() THEN RETURN 0; END IF;
  v_expira:=least(greatest(v_saldo,0),v_bonus);
  UPDATE public.qf_bonus_validade
     SET saldo_bonus_centavos=0,atualizado_em=now()
   WHERE profissional_id=p_profissional;
  IF v_expira>0 THEN
    UPDATE public.qf_carteiras
       SET saldo_centavos=saldo_centavos-v_expira,atualizado_em=now()
     WHERE profissional_id=p_profissional;
    INSERT INTO public.qf_movimentacoes_carteira(
      profissional_id,tipo,valor_centavos,referencia_tipo,descricao
    ) VALUES (
      p_profissional,'debito',v_expira,'bonus_expirado',
      'Bônus promocional expirado após o prazo de 10 dias'
    );
  END IF;
  RETURN v_expira;
END;
$$;
REVOKE ALL ON FUNCTION private.qf_expirar_bonus_profissional(uuid) FROM public,anon,authenticated;

-- Novas bonificacoes promocionais tambem ganham dez dias, sem alterar reembolsos.
CREATE OR REPLACE FUNCTION private.qf_bonus_prazo_nova_concessao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.tipo='bonus' AND NEW.referencia_tipo IN ('bonus_lancamento','bonus_massa') THEN
    PERFORM private.qf_expirar_bonus_profissional(NEW.profissional_id);
    INSERT INTO public.qf_bonus_validade(
      profissional_id,saldo_bonus_centavos,expira_em
    ) VALUES (NEW.profissional_id,NEW.valor_centavos,now()+interval '10 days')
    ON CONFLICT(profissional_id) DO UPDATE SET
      saldo_bonus_centavos=public.qf_bonus_validade.saldo_bonus_centavos+excluded.saldo_bonus_centavos,
      expira_em=excluded.expira_em,
      atualizado_em=now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS qf_bonus_prazo_nova_concessao ON public.qf_movimentacoes_carteira;
CREATE TRIGGER qf_bonus_prazo_nova_concessao
AFTER INSERT ON public.qf_movimentacoes_carteira
FOR EACH ROW EXECUTE FUNCTION private.qf_bonus_prazo_nova_concessao();

-- RPC autenticada para o relogio da area profissional; so devolve informacoes do proprio usuario.
CREATE OR REPLACE FUNCTION public.qf_meu_bonus_validade()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid:=auth.uid(); v_bonus bigint; v_expira timestamptz;
BEGIN
  IF v_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.qf_profissionais WHERE user_id=v_id
  ) THEN RETURN jsonb_build_object('ok',false,'reason','sem_permissao'); END IF;
  PERFORM private.qf_expirar_bonus_profissional(v_id);
  SELECT b.saldo_bonus_centavos,b.expira_em INTO v_bonus,v_expira
    FROM public.qf_bonus_validade b WHERE b.profissional_id=v_id;
  RETURN jsonb_build_object(
    'ok',true,'tem_bonus',coalesce(v_bonus,0)>0 AND v_expira>now(),
    'saldo_bonus_centavos',coalesce(v_bonus,0),
    'expira_em',v_expira,
    'saldo_pago_nao_expira',true
  );
END;
$$;
REVOKE ALL ON FUNCTION public.qf_meu_bonus_validade() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.qf_meu_bonus_validade() TO authenticated;

-- Nao permite uso dos creditos vencidos no desbloqueio, inclusive entre rotinas automaticas.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef('public.qf_desbloquear_chamado(uuid)'::regprocedure) INTO v_def;
  IF position('select saldo_centavos into v_saldo' in v_def)=0 THEN
    RAISE EXCEPTION 'Funcao de desbloqueio mudou; cancelado para evitar cobranca incorreta';
  END IF;
  v_def:=replace(v_def,'select saldo_centavos into v_saldo',
    'perform private.qf_expirar_bonus_profissional(v_prof);' || E'\n\n  ' || 'select saldo_centavos into v_saldo');
  EXECUTE v_def;
END $$;

CREATE OR REPLACE FUNCTION private.qf_expirar_bonus_pendentes()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b record;
BEGIN
  FOR b IN SELECT profissional_id FROM public.qf_bonus_validade
   WHERE saldo_bonus_centavos>0 AND expira_em<=now()
  LOOP
    PERFORM private.qf_expirar_bonus_profissional(b.profissional_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.qf_expirar_bonus_pendentes() FROM PUBLIC,anon,authenticated;

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='qf-expirar-bonus-promocional') THEN
   PERFORM cron.schedule('qf-expirar-bonus-promocional','*/15 * * * *',
    'SELECT private.qf_expirar_bonus_pendentes();');
 END IF;
END $$;
