-- Nenhum processamento enquanto os tres criterios de habilitacao forem falsos.
-- A chamada usa segredo do Vault já utilizado pelo push interno; nenhum segredo exposto.
select cron.schedule('qf-livre-pix-repasse-sync','* * * * *',
$job$
select case when exists (
 select 1 from private.qf_livre_pix_config
 where id and habilitado and homologado and pix_send_aprovado
) then net.http_post(
 url:='https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-livre-pix',
 headers:=jsonb_build_object(
  'Content-Type','application/json',
  'x-qf-internal',(select decrypted_secret from vault.decrypted_secrets where name='qf_push_internal' limit 1)
 ),
 body:='{"action":"sync"}'::jsonb,
 timeout_milliseconds:=30000
) else null::bigint end;
$job$);