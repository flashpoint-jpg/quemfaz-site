-- Conta quantos profissionais podem receber o reenvio MANUAL por pedido.
-- Usa a mesma elegibilidade do RPC qf_admin_lembrar_proximos.
-- Nao envia avisos; leitura restrita aos administradores autenticados.
create or replace function public.qf_admin_online_aptos(p_chamado_ids uuid[])
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_ids integer := coalesce(cardinality(p_chamado_ids), 0);
  v_itens jsonb;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if v_ids > 100 then
    return jsonb_build_object('ok', false, 'reason', 'Limite de 100 pedidos por consulta.');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', ids.id,
      'aptos', (select count(*)::integer from private.qf_lembrete_destinatarios(ids.id))
    )), '[]'::jsonb)
    into v_itens
    from (select distinct unnest(p_chamado_ids) as id) ids
    where ids.id is not null;
  return jsonb_build_object('ok', true, 'itens', v_itens);
end;
$function$;
revoke all on function public.qf_admin_online_aptos(uuid[]) from public, anon;
grant execute on function public.qf_admin_online_aptos(uuid[]) to authenticated;
