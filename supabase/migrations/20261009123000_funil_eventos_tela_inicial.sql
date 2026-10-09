ALTER TABLE public.qf_client_funnel DROP CONSTRAINT qf_client_funnel_event_check;
ALTER TABLE public.qf_client_funnel ADD CONSTRAINT qf_client_funnel_event_check CHECK (event = ANY (ARRAY['landing','form_view','form_start','submit','validation_error','access_error','publish_error','published','geo_timeout','field_focus','home_focus','home_type','home_submit','home_cta']));
