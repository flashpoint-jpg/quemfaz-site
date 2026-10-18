\set ON_ERROR_STOP on
-- Run only against a disposable PostgreSQL database after applying consent proposal.
-- Requires Supabase-compatible auth.uid() function and synthetic qf_profissionais fixture.
begin;
set local role anon;
do $$ begin
  if has_table_privilege(current_user,'public.qf_seo_consentimentos','SELECT') then
    raise exception 'anon can select consent table';
  end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ begin
  if (select count(*) from public.qf_seo_consentimentos) <> 0 then
    raise exception 'existing professionals must have no opt-in rows';
  end if;
end $$;
rollback;
