-- Sincronização bancária em até um minuto, sem expor segredo nos logs ou código.
-- Não faz chamadas enquanto o modelo não estiver homologado e habilitado.
select cron.schedule(
 'qf-livre-split-sync','* * * * *',
 $cron$
 select case when exists(
  select 1 from private.qf_livre_split_config where id and homologado and habilitado
 ) then net.http_post(
   url:='https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-livre-split',
   headers:=jsonb_build_object(
    'Content-Type','application/json',
    'x-qf-internal',(select decrypted_secret from vault.decrypted_secrets where name='qf_push_internal' limit 1)
   ),
   body:='{"action":"sync"}'::jsonb,
   timeout_milliseconds:=30000
 ) else null::bigint end;
 $cron$
);
