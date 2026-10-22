-- E-mail unico (por profissional) pedindo para ativar as notificacoes do celular.
CREATE TABLE IF NOT EXISTS public.qf_email_ativacao (
  user_id uuid PRIMARY KEY,
  email text,
  status text NOT NULL DEFAULT 'enviando',
  erro text,
  resend_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz
);
ALTER TABLE public.qf_email_ativacao ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qf_email_ativacao FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.qf_email_ativacao_disparar(p_teste_para text DEFAULT NULL, p_limite integer DEFAULT 20)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_seg text;
  v_ids uuid[];
BEGIN
  SELECT decrypted_secret INTO v_seg FROM vault.decrypted_secrets WHERE name='qf_push_internal' LIMIT 1;
  IF v_seg IS NULL OR length(v_seg)<32 THEN RAISE EXCEPTION 'segredo interno ausente'; END IF;

  IF p_teste_para IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-email-ativar',
      body := jsonb_build_object('teste_para',p_teste_para),
      headers := jsonb_build_object('Content-Type','application/json','x-qf-internal',v_seg),
      timeout_milliseconds := 20000);
    RETURN 1;
  END IF;

  SELECT coalesce(array_agg(x.user_id),array[]::uuid[]) INTO v_ids FROM (
    SELECT pr.user_id
    FROM public.qf_profissionais pr
    JOIN public.qf_profiles pf ON pf.id=pr.user_id AND coalesce(pf.ativo,true)
    WHERE NOT EXISTS (SELECT 1 FROM public.qf_push_subscriptions s WHERE s.user_id=pr.user_id AND s.ativo)
      AND NOT EXISTS (SELECT 1 FROM public.qf_email_ativacao e WHERE e.user_id=pr.user_id)
    ORDER BY pr.user_id
    LIMIT greatest(1,least(p_limite,50))
  ) x;
  IF cardinality(v_ids)=0 THEN RETURN 0; END IF;
  PERFORM net.http_post(
    url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-email-ativar',
    body := jsonb_build_object('user_ids',to_jsonb(v_ids)),
    headers := jsonb_build_object('Content-Type','application/json','x-qf-internal',v_seg),
    timeout_milliseconds := 120000);
  RETURN cardinality(v_ids);
END;
$function$;
REVOKE ALL ON FUNCTION private.qf_email_ativacao_disparar(text,integer) FROM PUBLIC, anon, authenticated;
