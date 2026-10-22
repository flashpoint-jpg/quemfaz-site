-- QuemFaz V11.52 — aviso simples (sem toque de chamado) quando o pedido vira "aberto a todos".
-- Antes: na etapa 3 a cascata avisava só até 100 km; quem é da profissão e está longe só via o
-- pedido se abrisse o app. Agora a edge function quemfaz-push (cascade_stage3 e evento interno
-- "aberto_todos") manda um aviso comum para os profissionais da MESMA profissão, de qualquer
-- região, que ainda não receberam aviso desse pedido. Fica registrado em qf_push_entregas com
-- evento 'aberto_todos' (não repete e não conta como aviso de chamado "new_call").

create or replace function public.qf_push_aberto_todos_destinatarios(p_chamado_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(array_agg(pr.user_id), array[]::uuid[])
    from public.qf_chamados c
    join public.qf_profissionais pr on c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
    join public.qf_profiles pf on pf.id = pr.user_id and coalesce(pf.ativo, true)
   where c.id = p_chamado_id
     and private.qf_chamado_aberto_todos(c.id) is not null
     and pr.user_id is distinct from c.cliente_id
     and private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null
     and not exists (select 1 from public.qf_desbloqueios d where d.chamado_id = c.id and d.profissional_id = pr.user_id)
     and not exists (select 1 from public.qf_push_entregas e where e.chamado_id = c.id and e.user_id = pr.user_id
                       and e.evento in ('new_call', 'aberto_todos'));
$function$;
revoke execute on function public.qf_push_aberto_todos_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.qf_push_aberto_todos_destinatarios(uuid) to service_role;
