-- Histórico preservado; versões antigas continuam gravando como versão 1.
ALTER TABLE public.qf_client_funnel ADD COLUMN measurement_version integer NOT NULL DEFAULT 1;
GRANT INSERT (id, measurement_version) ON public.qf_client_funnel TO anon, authenticated;
CREATE INDEX qf_client_funnel_v2_created_idx ON public.qf_client_funnel(created_at) WHERE measurement_version = 2 AND NOT teste;
CREATE OR REPLACE FUNCTION public.qf_client_funnel_summary_v2(p_days integer DEFAULT 7)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'pg_catalog','public'
AS $function$
WITH recent AS (
 SELECT * FROM public.qf_client_funnel
 WHERE measurement_version = 2 AND NOT teste AND created_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,7),90)))
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
 'measurement_started_at','2026-10-11T14:54:15.981693+00:00',
 'steps',coalesce((SELECT jsonb_object_agg(event,total) FROM steps),'{}'::jsonb),
 'sources',coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM sources s),'[]'::jsonb),
 'errors',coalesce((SELECT jsonb_agg(to_jsonb(e)) FROM errors e),'[]'::jsonb),
 'last_fields',coalesce((SELECT jsonb_agg(to_jsonb(f)) FROM fields f),'[]'::jsonb)
);
$function$;
REVOKE ALL ON FUNCTION public.qf_client_funnel_summary_v2(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qf_client_funnel_summary_v2(integer) TO authenticated;
