-- Instruções bancárias privadas: acessíveis apenas ao service_role da Edge Function.
create or replace function public.qf_livre_split_instrucao(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $$
declare b private.qf_livre_split_pagamentos;
begin
 if not exists(select 1 from private.qf_livre_split_config where id and habilitado and homologado)
 then return jsonb_build_object('ok',false,'reason','split_desligado');end if;
 select * into b from private.qf_livre_split_pagamentos where id=p_id;
 if not found or b.status not in('preparando','pix_pronto','pago','repassado')
 then return jsonb_build_object('ok',false,'reason','registro_indisponivel');end if;
 return jsonb_build_object('ok',true,'id',b.id,'fechamento_id',b.fechamento_id,
  'chamado_id',b.chamado_id,'profissional_id',b.profissional_id,
  'txid',b.txid,'split_id',b.split_id,'valor_centavos',b.valor_centavos,
  'profissional_centavos',b.profissional_centavos,'plataforma_centavos',b.plataforma_centavos,
  'conta_efi',b.conta_efi,'documento',b.documento,'status',b.status,
  'pix_copia_cola',b.pix_copia_cola,'checkout_url',b.checkout_url,
  'end_to_end_id',b.end_to_end_id);
end $$;
revoke all on function public.qf_livre_split_instrucao(uuid) from public,anon,authenticated;
grant execute on function public.qf_livre_split_instrucao(uuid) to service_role;

-- Somente a Edge autenticada com service-role consulta a fila para conciliação.
create or replace function public.qf_livre_split_pendentes()
returns jsonb language sql stable security definer set search_path to ''
as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
  select id from private.qf_livre_split_pagamentos
  where status in ('pix_pronto','pago') and criado_em>now()-interval '45 days'
  order by criado_em asc limit 50
 ) x
$$;
revoke all on function public.qf_livre_split_pendentes() from public,anon,authenticated;
grant execute on function public.qf_livre_split_pendentes() to service_role;
