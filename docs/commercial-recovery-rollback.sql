-- Operational rollback. Keeps the recovery history for audit.
select cron.unschedule('qf-recuperacao-comercial');
-- Revert the application commit to remove the two new UI sections and tracking guard.
-- Existing distribution, prices, wallets, payments and order records are unchanged.
-- After the UI rollback, optional cleanup:
-- drop function public.qf_admin_funil_comercial();
-- drop function private.qf_recuperar_pedidos_sem_desbloqueio();
-- Keep private.qf_pedido_recuperacoes until its audit data is no longer needed.
