-- Administrador vê quando o profissional solicitou saque antes de registrar repasse.
CREATE OR REPLACE FUNCTION private.qf_livre_manual_pix_admin_ledger()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not private.qf_is_admin() then raise exception 'admin_obrigatorio';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc),'[]') from (
 select v.id,v.fechamento_id,v.chamado_id,v.profissional_id,p.nome profissional,v.txid,v.end_to_end_id,
 v.valor_centavos,v.comissao_centavos,v.profissional_centavos,v.status,v.criado_em,v.confirmado_em,
 v.repassado_em,v.repasse_referencia,v.repasse_comprovante,v.repasse_admin,v.saque_solicitado_em,k.chave_pix pix_chave,
 coalesce((select jsonb_agg(jsonb_build_object('tipo',e.tipo,'ator',e.ator,'criado_em',e.criado_em)
 order by e.criado_em) from private.qf_livre_manual_eventos e where e.pagamento_id=v.id),'[]') eventos
 from private.qf_livre_manual_pix v join public.qf_profiles p on p.id=v.profissional_id
 left join public.qf_livre_pix_chaves k on k.profissional_id=v.profissional_id) x);
end $function$
;
