-- Synthetic isolated fixture only. Never apply to a hosted project.
create role anon nologin;
create role authenticated nologin;
grant authenticated to postgres;
grant anon to postgres;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.qf_profissionais (
 user_id uuid primary key,
 especialidades text[] not null default '{}',
 raio_km integer,
 latitude numeric,
 longitude numeric
);
insert into public.qf_profissionais(user_id,especialidades,raio_km,latitude,longitude) values
('00000000-0000-4000-8000-000000000001',array['pintor'],15,-23.66,-46.53),
('00000000-0000-4000-8000-000000000002',array['eletricista'],20,-23.69,-46.56);
grant usage on schema public,auth to anon,authenticated;
grant execute on function auth.uid() to authenticated;
