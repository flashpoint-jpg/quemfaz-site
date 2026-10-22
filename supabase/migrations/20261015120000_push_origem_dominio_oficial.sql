-- V11.92: guarda de qual endereço veio cada inscrição de notificação web.
-- O envio só usa inscrições do domínio oficial (ou antigas, sem origem); o endereço de preview da
-- Vercel duplicava avisos e o Chrome passou a marcar como "possível spam".
alter table public.qf_push_subscriptions add column if not exists origem text;
