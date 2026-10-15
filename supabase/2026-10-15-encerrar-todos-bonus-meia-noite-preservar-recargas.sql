-- Quem Faz: encerramento definitivo de TODOS os bonus na meia-noite
-- Brasilia: 2026-10-16 00:00 BRT = 2026-10-16 03:00 UTC.
-- PRESERVAR recargas pagas, historico financeiro, estornos e planos.
-- ATENCAO: validar qf_bonus_validade e a composicao das carteiras no banco
-- antes de executar. Salvar no GitHub NAO executa esta migracao.
BEGIN;

-- O bonus ainda nao gasto vence na meia-noite. Nao toca na carteira antes disso.
UPDATE public.qf_bonus_validade
   SET expira_em = LEAST(expira_em, '2026-10-16 03:00:00+00'::timestamptz),
       atualizado_em = now()
 WHERE saldo_bonus_centavos > 0
   AND expira_em > '2026-10-16 03:00:00+00'::timestamptz;

-- Enquanto nao chega a meia-noite, nenhuma concessao pode estender o vencimento.
CREATE OR REPLACE FUNCTION private.qf_bonus_limitar_a_meia_noite()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  NEW.expira_em := LEAST(NEW.expira_em, '2026-10-16 03:00:00+00'::timestamptz);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS qf_bonus_limitar_a_meia_noite ON public.qf_bonus_validade;
CREATE TRIGGER qf_bonus_limitar_a_meia_noite
BEFORE INSERT OR UPDATE OF expira_em ON public.qf_bonus_validade
FOR EACH ROW EXECUTE FUNCTION private.qf_bonus_limitar_a_meia_noite();

-- Recargas PAGAS continuam creditadas normalmente.
-- Apenas a parcela EXTRA, antes chamada bonus de recarga, sera zero apos o corte.
-- STABLE, e nao IMMUTABLE, porque agora depende do horario.
CREATE OR REPLACE FUNCTION public.qf_bonus_recarga_centavos(p_valor_centavos integer)
RETURNS integer LANGUAGE sql STABLE SET search_path TO '' AS $$
  SELECT CASE
    WHEN now() >= '2026-10-16 03:00:00+00'::timestamptz THEN 0
    ELSE LEAST(10000, (coalesce(p_valor_centavos,0) * CASE
      WHEN p_valor_centavos >= 20000 THEN 10
      WHEN p_valor_centavos >= 10000 THEN 8
      WHEN p_valor_centavos >= 5000 THEN 5
      ELSE 0 END) / 100)::integer
  END;
$$;
GRANT EXECUTE ON FUNCTION public.qf_bonus_recarga_centavos(integer) TO anon,authenticated;

-- Impede que concessoes de bonus posteriores anulem o encerramento,
-- sem bloquear recargas, estornos e creditos pagos (tipo='credito').
CREATE OR REPLACE FUNCTION private.qf_impedir_novos_bonus_apos_corte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF now() >= '2026-10-16 03:00:00+00'::timestamptz AND NEW.tipo='bonus' THEN
    RAISE EXCEPTION 'Concessoes de bonus encerradas em 16/10/2026'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS qf_impedir_novos_bonus_apos_corte ON public.qf_movimentacoes_carteira;
CREATE TRIGGER qf_impedir_novos_bonus_apos_corte
BEFORE INSERT ON public.qf_movimentacoes_carteira
FOR EACH ROW EXECUTE FUNCTION private.qf_impedir_novos_bonus_apos_corte();

-- Liquida cada carteira pelo mecanismo ja existente, que desconta apenas
-- min(saldo_atual, saldo_bonus_remanescente) e gera extrato de bonus expirado.
-- A acao e idempotente e nao faz contato/push/aviso.
CREATE OR REPLACE FUNCTION private.qf_encerrar_bonus_20261016()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;
BEGIN
  IF now() < '2026-10-16 03:00:00+00'::timestamptz THEN
    RETURN;
  END IF;

  -- Desliga automaticamente o bonus de cadastro na hora do corte.
  UPDATE public.qf_config
     SET valor=jsonb_set(valor,'{ativo}','false'::jsonb,true),
         atualizado_em=now()
   WHERE chave='bonus_cadastro'
     AND coalesce((valor->>'ativo')::boolean,false);

  FOR r IN
    SELECT profissional_id FROM public.qf_bonus_validade
     WHERE saldo_bonus_centavos>0
     ORDER BY profissional_id
  LOOP
    PERFORM private.qf_expirar_bonus_profissional(r.profissional_id);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.qf_encerrar_bonus_20261016() FROM PUBLIC,anon,authenticated;

-- Execucao agendada em UTC. O cron a cada 15 min, ja existente no app,
-- tambem processara estes bonus no primeiro minuto apos o vencimento.
DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='qf-encerrar-todos-bonus-20261016') THEN
    PERFORM cron.schedule(
      'qf-encerrar-todos-bonus-20261016',
      '0 3 16 10 *',
      'SELECT private.qf_encerrar_bonus_20261016();'
    );
  END IF;
END;
$schedule$;

COMMIT;

-- VALIDACAO ANTES: resumir quantos bonus e quanto saldo pago podem ser afetados:
-- SELECT count(*), sum(saldo_bonus_centavos) FROM public.qf_bonus_validade WHERE saldo_bonus_centavos>0;
-- SELECT jobname,schedule,command FROM cron.job WHERE jobname='qf-encerrar-todos-bonus-20261016';
-- VALIDACAO DEPOIS: conferir apenas bonus_expirado em qf_movimentacoes_carteira.
