-- Pix confirmado gera aviso oficial ao profissional, sem split nem pagamento automático.
CREATE OR REPLACE FUNCTION public.qf_livre_manual_pix_liquidar(p_id uuid, p_txid text, p_e2e text, p_valor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v private.qf_livre_manual_pix; f public.qf_comissao13_fechamentos;
begin
 select * into v from private.qf_livre_manual_pix where id=p_id for update;
 if not found or v.txid<>p_txid or v.valor_centavos<>p_valor or length(coalesce(p_e2e,''))<16
 then return jsonb_build_object('ok',false,'reason','pagamento_incompativel');end if;
 if v.status in ('pago','repassado') then
  return jsonb_build_object('ok',v.end_to_end_id=p_e2e,'status',v.status,'duplicado',true);
 end if;
 if v.status<>'pix_pronto' then return jsonb_build_object('ok',false,'reason','estado_invalido');end if;
 select * into f from public.qf_comissao13_fechamentos where id=v.fechamento_id for update;
 if f.status<>'confirmado' or f.valor_confirmado_centavos<>p_valor or f.codigo_validado_em is null
 or f.cliente_concluiu_em is null or f.cobranca_status not in ('pendente','paga')
 then return jsonb_build_object('ok',false,'reason','fechamento_invalido');end if;
 update private.qf_livre_manual_pix set status='pago',end_to_end_id=p_e2e,confirmado_em=now(),atualizado_em=now()
 where id=v.id;
 update public.qf_comissao13_fechamentos set cobranca_status='paga',comissao_paga_em=now(),
 comissao_vence_em=null where id=f.id and cobranca_status='pendente';
 -- Notificar o profissional pelo chat após a confirmação bancária.
 -- A notificação não pode impedir nem duplicar a liquidação do Pix.
 begin
  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
   select v.chamado_id,v.profissional_id,c.cliente_id,
    'Pagamento do serviço confirmado pelo banco. Sua parte de 87% está disponível para solicitar saque na Carteira. O repasse será manual, pela equipe Quem Faz.',
    'sistema' from public.qf_chamados c where c.id=v.chamado_id;
  perform private.qf_push_interno('chat_message',v.chamado_id);
 exception when others then
  null;
 end;
 return jsonb_build_object('ok',true,'status','pago');
end $function$
;
