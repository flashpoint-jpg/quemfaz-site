-- Retestar pedidos abertos no inicio do horario escolhido pelo profissional.
-- O envio usa a Edge Function de push e so chega para profissionais online,
-- inscritos em notificacoes e com vaga, categoria e regiao compativeis.
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
  r record;
BEGIN
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
    SELECT c.id as chamado_id, pr.user_id as profissional_id
    FROM public.qf_profissionais pr
    JOIN public.qf_profiles pf ON pf.id=pr.user_id AND coalesce(pf.ativo,true)
    JOIN public.qf_chamados c ON c.categoria=any(coalesce(pr.especialidades,array[]::text[]))
    WHERE pr.online IS TRUE
      AND coalesce(pr.offline_manual,false) IS FALSE
      -- 24 horas nao tem troca de expediente; para os demais, tolerancia
      -- de 3 minutos para o cron e horario de virada da meia-noite.
      AND pr.horario_inicio IS NOT NULL
      AND pr.horario_fim IS NOT NULL
      AND pr.horario_inicio<>pr.horario_fim
      AND mod(
        extract(epoch FROM v_local)::int
        -extract(epoch FROM pr.horario_inicio)::int
        +86400,86400
      ) < 180
      AND c.status IN ('aberto','em_negociacao')
      AND c.cliente_id IS DISTINCT FROM pr.user_id
      AND (c.data_preferida IS NULL OR c.data_preferida<=now()+interval '24 hours')
      AND EXISTS (
        SELECT 1 FROM public.qf_push_subscriptions s
        WHERE s.user_id=pr.user_id AND s.ativo
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.qf_push_entregas e
        WHERE e.chamado_id=c.id AND e.user_id=pr.user_id AND e.evento='new_call'
      )
      AND EXISTS (
        SELECT 1 FROM public.qf_chamado_destinatarios_alcance(c.id,100) t
        WHERE t.user_id=pr.user_id
      )
    ORDER BY c.criado_em DESC,pr.user_id
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
        timeout_milliseconds := 5000
      );
    END IF;
    v_total:=v_total+1;
  END LOOP;
  RETURN v_total;
END;
$function$
;
REVOKE ALL ON FUNCTION private.qf_avisar_inicio_expediente(boolean) FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('qf-inicio-expediente-pedidos','* * * * *','SELECT private.qf_avisar_inicio_expediente();');
