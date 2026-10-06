-- Origem por pedido, sem alterar chamados antigos ou regras de cobrança.
alter table public.qf_chamados add column if not exists marketing_origem jsonb not null default '{}'::jsonb;

create table public.qf_client_funnel (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id uuid not null,
  event text not null check (event in ('landing','form_view','form_start','submit','validation_error','access_error','publish_error','published','geo_timeout')),
  category text check (length(category) <= 120),
  source text check (length(source) <= 120),
  campaign text check (length(campaign) <= 240),
  content text check (length(content) <= 240),
  request_id uuid,
  error_code text check (length(error_code) <= 80),
  duration_ms integer check (duration_ms between 0 and 3600000),
  check ((event = 'published' and request_id is not null) or (event <> 'published' and request_id is null))
);
create index qf_client_funnel_created_at_idx on public.qf_client_funnel(created_at);
create unique index qf_client_funnel_published_idx on public.qf_client_funnel(request_id) where event='published';
alter table public.qf_client_funnel enable row level security;
revoke all on public.qf_client_funnel from anon, authenticated;
grant insert (session_id,event,category,source,campaign,content,request_id,error_code,duration_ms) on public.qf_client_funnel to anon,authenticated;
grant select on public.qf_client_funnel to authenticated;
grant all on public.qf_client_funnel to service_role;
create policy qf_funnel_steps_insert on public.qf_client_funnel for insert to anon,authenticated
  with check (event <> 'published' and request_id is null);
create policy qf_funnel_confirmed_insert on public.qf_client_funnel for insert to authenticated
  with check (event='published' and exists (select 1 from public.qf_chamados c where c.id=request_id and c.cliente_id=(select auth.uid())));
create policy qf_funnel_admin_read on public.qf_client_funnel for select to authenticated
  using ((select private.qf_is_admin()));

create function public.qf_client_funnel_summary(p_days integer default 7)
returns jsonb language sql stable security invoker set search_path=pg_catalog,public as $$
  with recent as (
    select * from public.qf_client_funnel
    where created_at >= now() - make_interval(days => greatest(1,least(coalesce(p_days,7),90)))
  ), steps as (
    select event,case when event='published' then count(distinct request_id) else count(distinct session_id) end as total
    from recent group by event
  ), sources as (
    select coalesce(nullif(source,''),'Sem origem identificada') as source,count(distinct request_id) as requests
    from recent where event='published' group by 1
  ), errors as (
    select event,error_code as code,count(*) as total from recent
    where event in ('validation_error','access_error','publish_error','geo_timeout') group by event,error_code
  )
  select jsonb_build_object(
    'steps',coalesce((select jsonb_object_agg(event,total) from steps),'{}'::jsonb),
    'sources',coalesce((select jsonb_agg(to_jsonb(s)) from sources s),'[]'::jsonb),
    'errors',coalesce((select jsonb_agg(to_jsonb(e)) from errors e),'[]'::jsonb)
  );
$$;
revoke all on function public.qf_client_funnel_summary(integer) from public,anon;
grant execute on function public.qf_client_funnel_summary(integer) to authenticated;
