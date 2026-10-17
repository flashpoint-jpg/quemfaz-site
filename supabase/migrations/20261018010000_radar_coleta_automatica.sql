-- Radar de Leads Externos: coleta automática (já aplicada em produção em 2026-10-17).
-- A função de borda qf-radar-coleta (supabase/functions/qf-radar-coleta) lê as fontes habilitadas e grava em staging.
-- Autenticação: JWT anon (público) basta para acionar; a função respeita o intervalo mínimo de cada fonte e nunca
-- cria pedidos, notificações ou cobranças. A chave de serviço fica só no ambiente da função.

-- Bluesky: a busca pública devolveu 403 sem login → fonte registrada, mas desabilitada (não contornamos).
insert into public.qf_lead_sources (id,label,kind,config,allowed_host,authorization_note,terms_url,rate_limit_minutes,enabled)
values ('bluesky_abc','Bluesky · busca pública (Grande ABC)','bluesky',
 '{"queries":["preciso de pintor Santo André","preciso de eletricista Santo André","preciso de encanador Santo André","preciso de diarista Santo André","preciso de pintor São Bernardo","preciso de eletricista São Bernardo","procuro encanador São Bernardo","preciso de diarista São Bernardo","preciso de eletricista Diadema","preciso de pedreiro Mauá","procuro chaveiro Grande ABC","alguém indica eletricista São Caetano"],"lang":"pt","limit":25}',
 'bsky.app','API pública oficial do Bluesky (app.bsky.feed.searchPosts); busca sem login retornou 403 em 2026-10-17, então fica desabilitada até haver credencial (senha de app).',
 'https://bsky.social/about/support/tos',180,false)
on conflict (id) do nothing;

insert into public.qf_lead_sources (id,label,kind,config,allowed_host,authorization_note,terms_url,rate_limit_minutes,enabled)
values ('mastodon_abc','Mastodon · hashtags públicas (Grande ABC)','mastodon',
 '{"instance":"mastodon.social","hashtags":["SantoAndre","SaoBernardoDoCampo","SaoCaetanoDoSul","Diadema","GrandeABC","ABCPaulista","Maua"]}',
 'mastodon.social','API pública oficial do Mastodon (GET /api/v1/timelines/tag/:hashtag), sem login, posts públicos, sem contornar limites; autorizado pelo responsável do Quem Faz em 2026-10-17. Intervalo mínimo de 3h.',
 'https://mastodon.social/terms-of-service',180,true)
on conflict (id) do nothing;

select cron.unschedule('qf-radar-coleta') where exists (select 1 from cron.job where jobname='qf-radar-coleta');
select cron.schedule('qf-radar-coleta','23 */3 * * *',$cron$select net.http_post(url:='https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/qf-radar-coleta', headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjemx5cmduemx4bXpnaHphb296Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAwMzc5NzEsImV4cCI6MjEwNTYxMzk3MX0.5G694Lasib5q5enD_ypWXx3x9IXNOHRi96VP-qie6GI'), body:='{}'::jsonb, timeout_milliseconds:=120000)$cron$);
