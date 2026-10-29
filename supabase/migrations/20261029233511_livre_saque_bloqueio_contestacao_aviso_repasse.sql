create or replace function public.qf_livre_manual_pix_solicitar(p_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $saque$
declare v private.qf_livre_manual_pix; v_k public.qf_livre_pix_chaves;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false,'reason','nao_autenticado');end if;
 select * into v from private.qf_livre_manual_pix where id=p_id for update;
 if not found or v.profissional_id is distinct from auth.uid()
 then return jsonb_build_object('ok',false,'reason','sem_permissao');end if;
 if v.status='repassado' then return jsonb_build_object('ok',false,'reason','ja_repassado');end if;
 if v.status<>'pago' or v.confirmado_em is null or v.end_to_end_id is null
 then return jsonb_build_object('ok',false,'reason','pagamento_nao_confirmado');end if;
 -- Bloqueia contestação, estorno e fechamento sem conclusão confirmada.
 perform 1 from public.qf_comissao13_fechamentos f
 where f.id=v.fechamento_id and f.status='confirmado' and f.cobranca_status='paga'
 and f.codigo_validado_em is not null and f.cliente_concluiu_em is not null
 for update;
 if not found then return jsonb_build_object('ok',false,'reason','fechamento_contestado_ou_nao_liquidado');end if;
 if v.saque_solicitado_em is not null
 then return jsonb_build_object('ok',true,'duplicado',true,'solicitado_em',v.saque_solicitado_em);end if;
 select * into v_k from public.qf_livre_pix_chaves where profissional_id=v.profissional_id;
 if not found or length(trim(v_k.chave_pix))<5 then
 return jsonb_build_object('ok',false,'reason','chave_pix_ausente');end if;
 update private.qf_livre_manual_pix set saque_solicitado_em=now(),atualizado_em=now()
 where id=v.id;
 return jsonb_build_object('ok',true,'solicitado',true,'profissional_centavos',v.profissional_centavos);
end $saque$;
CREATE OR REPLACE FUNCTION public.qf_livre_manual_pix_repassar(p_id uuid, p_referencia text, p_comprovante text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v private.qf_livre_manual_pix; k public.qf_livre_pix_chaves;
begin
 if auth.uid() is null or not private.qf_is_admin() then
 return jsonb_build_object('ok',false,'reason','admin_obrigatorio');end if;
 if length(trim(coalesce(p_referencia,'')))<16 or length(trim(coalesce(p_comprovante,'')))<8
 then return jsonb_build_object('ok',false,'reason','comprovacao_obrigatoria');end if;
 select * into v from private.qf_livre_manual_pix where id=p_id for update;
 if not found or v.status<>'pago' or v.confirmado_em is null or v.end_to_end_id is null or v.saque_solicitado_em is null
 then return jsonb_build_object('ok',false,'reason','pix_nao_conciliado_ou_repassado');end if;
 -- Bloqueia contestação, estorno e fechamento sem conclusão confirmada.
 perform 1 from public.qf_comissao13_fechamentos f
 where f.id=v.fechamento_id and f.status='confirmado' and f.cobranca_status='paga'
 and f.codigo_validado_em is not null and f.cliente_concluiu_em is not null
 for update;
 if not found then return jsonb_build_object('ok',false,'reason','fechamento_contestado_ou_nao_liquidado');end if;
 select * into k from public.qf_livre_pix_chaves where profissional_id=v.profissional_id;
 if not found or length(trim(k.chave_pix))<5
 then return jsonb_build_object('ok',false,'reason','chave_pix_ausente');end if;
 -- A movimentação financeira é EXTERNA e MANUAL; este RPC só registra comprovante.
 update private.qf_livre_manual_pix set status='repassado',repassado_em=now(),
 repasse_admin=auth.uid(),repasse_referencia=left(trim(p_referencia),150),
 repasse_comprovante=left(trim(p_comprovante),500),atualizado_em=now() where id=v.id;
 -- Aviso somente depois do registro administrativo; não envia dinheiro.
 begin
  insert into public.qf_chat_mensagens(chamado_id,profissional_id,remetente_id,mensagem,tipo)
  select v.chamado_id,v.profissional_id,c.cliente_id,
   'Repasse manual confirmado pela equipe Quem Faz. Consulte sua Carteira para acompanhar o pagamento.', 'sistema'
  from public.qf_chamados c where c.id=v.chamado_id;
  perform private.qf_push_interno('chat_message',v.chamado_id);
 exception when others then
  raise warning 'Notificação de repasse indisponível';
 end;
 return jsonb_build_object('ok',true,'status','repassado','profissional_centavos',v.profissional_centavos);
end $function$
;
revoke all on function public.qf_livre_manual_pix_solicitar(uuid) from public,anon;
grant execute on function public.qf_livre_manual_pix_solicitar(uuid) to authenticated;
