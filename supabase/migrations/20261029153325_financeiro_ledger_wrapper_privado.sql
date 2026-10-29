alter function public.qf_livre_manual_pix_admin_ledger() set schema private;
create function public.qf_livre_manual_pix_admin_ledger() returns jsonb
 language sql security invoker set search_path='' as $$select private.qf_livre_manual_pix_admin_ledger()$$;
revoke all on function public.qf_livre_manual_pix_admin_ledger() from public,anon;
grant execute on function public.qf_livre_manual_pix_admin_ledger() to authenticated;
