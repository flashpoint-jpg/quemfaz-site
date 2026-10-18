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
