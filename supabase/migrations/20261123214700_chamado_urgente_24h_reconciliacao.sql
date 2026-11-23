select cron.schedule('qf-plantao-24h-pix','* * * * *','select private.qf_plantao_reconciliar_job()');
