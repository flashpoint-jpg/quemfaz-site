-- Reversão: re-executar supabase/2026-10-18-pedidos-valor-definido-qr.sql (todas as funções são "create or replace")
-- restaura as funções de valor definido/6%. Depois:
update public.qf_config set valor = jsonb_set(valor, '{multiplicador}', '3'::jsonb) where chave = 'desbloqueio_exclusivo';
drop function if exists public.qf_orcamento_info_chamados(uuid[]);
-- A coluna orcamento_aproximado_centavos é mantida de propósito (não apagar dados do cliente).
