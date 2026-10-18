\\set ON_ERROR_STOP on
-- Only disposable fixture. Test RLS with fake JWT identity.
begin;
set local role anon;
do $$ begin
 if has_table_privilege(current_user,'public.qf_seo_consentimentos','SELECT') then
  raise exception 'anon has consent SELECT';
 end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.qf_seo_consentimentos) <> 0 then
  raise exception 'new migration unexpectedly grants consent';
 end if;
end $$;
insert into public.qf_seo_consentimentos(profissional_id,autorizado,autorizado_em)
values('00000000-0000-4000-8000-000000000001',true,now());
do $$ begin
 if (select count(*) from public.qf_seo_consentimentos where autorizado) <> 1 then
  raise exception 'owner cannot read own consent';
 end if;
end $$;
do $$ begin
 begin
  insert into public.qf_seo_consentimentos(profissional_id,autorizado,autorizado_em)
  values('00000000-0000-4000-8000-000000000002',true,now());
  raise exception 'foreign owner insert unexpectedly succeeded';
 exception when insufficient_privilege then null;
 end;
end $$;
update public.qf_seo_consentimentos set autorizado=false, autorizado_em=null
where profissional_id='00000000-0000-4000-8000-000000000001';
do $$ begin
 if exists(select 1 from public.qf_seo_consentimentos where autorizado) then
  raise exception 'revocation did not clear consent';
 end if;
end $$;
rollback;

-- Check anonymous cannot write consent, including with a forged JWT claim.
begin;
set local role anon;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
  if has_table_privilege(current_user,'public.qf_seo_consentimentos','INSERT')
     or has_table_privilege(current_user,'public.qf_seo_consentimentos','UPDATE')
     or has_table_privilege(current_user,'public.qf_seo_consentimentos','DELETE') then
    raise exception 'anon can modify consent';
  end if;
end $$;
rollback;

-- Ownership isolation and cross-owner UPDATE are tested with two fictional users.
begin;
insert into public.qf_seo_consentimentos(profissional_id,autorizado,autorizado_em)
values ('00000000-0000-4000-8000-000000000001',true,now()),
       ('00000000-0000-4000-8000-000000000002',true,now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.qf_seo_consentimentos) <> 1 then
   raise exception 'authenticated user sees another owner consent';
 end if;
end $$;
update public.qf_seo_consentimentos set autorizado=false
where profissional_id='00000000-0000-4000-8000-000000000002';
do $$ begin
 if (select count(*) from public.qf_seo_consentimentos where autorizado) <> 1 then
   raise exception 'cross-owner update succeeded';
 end if;
end $$;
rollback;

-- Constraint: consent cannot be enabled without timestamp.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
 begin
  insert into public.qf_seo_consentimentos(profissional_id,autorizado)
  values ('00000000-0000-4000-8000-000000000001',true);
  raise exception 'consent without timestamp succeeded';
 exception when check_violation then null;
 end;
end $$;
rollback;
