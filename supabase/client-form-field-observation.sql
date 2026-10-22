ALTER TABLE public.qf_client_funnel DROP CONSTRAINT qf_client_funnel_event_check;
ALTER TABLE public.qf_client_funnel ADD CONSTRAINT qf_client_funnel_event_check CHECK (event = ANY (ARRAY['landing','form_view','form_start','submit','validation_error','access_error','publish_error','published','geo_timeout','field_focus']));
CREATE OR REPLACE FUNCTION public.qf_client_funnel_summary(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'pg_catalog','public'
AS $function$
WITH recent AS (
 SELECT * FROM public.qf_client_funnel
 WHERE created_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,7),90)))
), steps AS (
 SELECT event, CASE WHEN event='published' THEN count(distinct request_id) ELSE count(distinct session_id) END AS total
 FROM recent GROUP BY event
), sources AS (
 SELECT coalesce(nullif(source,''),'Sem origem identificada') AS source,count(distinct request_id) AS requests
 FROM recent WHERE event='published' GROUP BY 1
), errors AS (
 SELECT event,error_code AS code,count(*) AS total FROM recent
 WHERE event IN ('validation_error','access_error','publish_error','geo_timeout') GROUP BY event,error_code
), incomplete AS (
 SELECT session_id FROM recent GROUP BY session_id
 HAVING count(*) FILTER (WHERE event='published')=0 AND max(created_at)<now()-interval '30 minutes'
), last_focus AS (
 SELECT DISTINCT ON (r.session_id) r.session_id,r.error_code AS field
 FROM recent r JOIN incomplete i USING (session_id)
 WHERE r.event='field_focus' ORDER BY r.session_id,r.created_at DESC,r.id DESC
), fields AS (
 SELECT field,count(*) AS sessions FROM last_focus GROUP BY field ORDER BY sessions DESC,field
)
SELECT jsonb_build_object(
 'steps',coalesce((SELECT jsonb_object_agg(event,total) FROM steps),'{}'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sources s),'[]'::jsonb),
 'errors',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM errors e),'[]'::jsonb),
 'last_fields',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM fields f),'[]'::jsonb)
);
$function$;