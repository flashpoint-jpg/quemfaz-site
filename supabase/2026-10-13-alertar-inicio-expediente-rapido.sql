-- Corrige o aviso de inicio do horario: as 06:00 (quando quase todos os
-- profissionais comecam) a versao anterior calculava o alcance de cada pedido
-- uma vez por profissional e estourava o tempo limite de 120 s.
-- Agora: sai na hora se ninguem comeca neste minuto e calcula o alcance
-- uma unica vez por pedido aberto.
CREATE OR REPLACE FUNCTION private.qf_avisar_inicio_expediente(p_simular boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_seg text;
  v_total integer := 0;
  v_local time := (now() at time zone 'America/Sao_Paulo')::time;
  v_pros uuid[];
  r record;
BEGIN
  -- Profissionais que acabaram de entrar no horario (tolerancia de 3 minutos
  -- para o cron e para a virada da meia-noite; 24 horas nao tem troca).
  SELECT coalesce(array_agg(pr.user_id),array[]::uuid[]) INTO v_pros
  FROM public.qf_profissionais pr
  JOIN public.qf_profiles pf ON pf.id=pr.user_id AND coalesce(pf.ativo,true)
  WHERE pr.online IS TRUE
    AND coalesce(pr.offline_manual,false) IS FALSE
    AND pr.horario_inicio IS NOT NULL
    AND pr.horario_fim IS NOT NULL
    AND pr.horario_inicio<>pr.horario_fim
    AND mod(
      extract(epoch FROM v_local)::int
      -extract(epoch FROM pr.horario_inicio)::int
      +86400,86400
    ) < 180
    AND EXISTS (
      SELECT 1 FROM public.qf_push_subscriptions s
      WHERE s.user_id=pr.user_id AND s.ativo
    );

  IF cardinality(v_pros)=0 THEN
    RETURN 0;
  END IF;

  IF NOT p_simular THEN
    SELECT decrypted_secret INTO v_seg
    FROM vault.decrypted_secrets
    WHERE name='qf_push_internal'
    LIMIT 1;
    IF v_seg IS NULL OR length(v_seg)<32 THEN
      RAISE WARNING 'QuemFaz: segredo interno de push nao configurado';
      RETURN 0;
    END IF;
  END IF;

  FOR r IN
    WITH chamados AS MATERIALIZED (
      SELECT c.id,c.criado_em
      FROM public.qf_chamados c
      WHERE c.status IN ('aberto','em_negociacao')
        AND (c.data_preferida IS NULL OR c.data_preferida<=now()+interval '24 hours')
        AND EXISTS (
          SELECT 1 FROM public.qf_profissionais pr
          WHERE pr.user_id=any(v_pros)
            AND c.categoria=any(coalesce(pr.especialidades,array[]::text[]))
        )
    )
    SELECT c.id as chamado_id, t.user_id as profissional_id
    FROM chamados c
    CROSS JOIN LATERAL public.qf_chamado_destinatarios_alcance(c.id,100) t
    WHERE t.user_id=any(v_pros)
      AND NOT EXISTS (
        SELECT 1 FROM public.qf_push_entregas e
        WHERE e.chamado_id=c.id AND e.user_id=t.user_id AND e.evento='new_call'
      )
    ORDER BY c.criado_em DESC,t.user_id
    LIMIT 500
  LOOP
    IF NOT p_simular THEN
      PERFORM net.http_post(
        url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-push',
        body := jsonb_build_object(
          'action','notify_internal',
          'event','shift_start',
          'call_id',r.chamado_id,
          'user_id',r.profissional_id
        ),
        headers := jsonb_build_object('Content-Type','application/json','x-qf-internal',v_seg),
        timeout_milliseconds := 15000
      );
    END IF;
    v_total:=v_total+1;
  END LOOP;
  RETURN v_total;
END;
$function$
;
REVOKE ALL ON FUNCTION private.qf_avisar_inicio_expediente(boolean) FROM PUBLIC, anon, authenticated;
