-- QuemFaz V11.53 — "Simular chamado": o painel sabe se o profissional usa o app Android (APK) ou o PWA.
-- O APK 12 não informa a chegada do aviso; sem isso o painel mostrava "não chegou" para quem usa o APK.
-- Só admin. apk/web = aparelhos ativos de cada tipo no momento da consulta.
create or replace function public.qf_admin_chamados_teste()
returns table(id uuid, profissional_id uuid, enviado_em timestamptz, chegou_em timestamptz, confirmado_em timestamptz, envio jsonb, apk integer, web integer)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.qf_is_admin() then raise exception 'admin authentication required'; end if;
  return query
    select t.id, t.profissional_id, t.enviado_em, t.chegou_em, t.confirmado_em, t.envio,
      (select count(*)::integer from public.qf_push_subscriptions s where s.user_id = t.profissional_id and s.ativo and s.endpoint like 'fcm:%'),
      (select count(*)::integer from public.qf_push_subscriptions s where s.user_id = t.profissional_id and s.ativo and s.endpoint not like 'fcm:%')
    from public.chamados_teste t
    order by t.enviado_em desc
    limit 2000;
end;
$function$;
revoke execute on function public.qf_admin_chamados_teste() from public, anon;
grant execute on function public.qf_admin_chamados_teste() to authenticated;
