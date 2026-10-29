-- Baixa final após transferência feita fora do sistema e comprovada.
create or replace function public.qf_repasses_manuais_admin(
 p_repasse_id uuid, p_acao text, p_referencia text default null, p_comprovante text default null, p_observacao text default null
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_r public.qf_repasses_manuais;
v_f public.qf_comissao13_financeiro; v_a public.qf_comissao13_acordos;
v_k public.qf_livre_pix_chaves;
begin
 if v_uid is null or not private.qf_is_admin() then
   return jsonb_build_object('ok',false,'reason','nao_autorizado');
 end if;
 if p_acao not in ('analisar','bloquear','confirmar') then
   return jsonb_build_object('ok',false,'reason','acao_invalida');
 end if;
 select * into v_r from public.qf_repasses_manuais where id=p_repasse_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','nao_encontrado'); end if;
 if v_r.status='pago' then return jsonb_build_object('ok',false,'reason','ja_pago'); end if;
 select * into v_f from public.qf_comissao13_financeiro where id=v_r.financeiro_id for update;
 select * into v_a from public.qf_comissao13_acordos where id=v_r.acordo_id;
 if p_acao='confirmar' then
  if v_r.status not in ('solicitado','em_analise') or v_f.status<>'pago' or v_f.pago_em is null
   or v_f.estornado_centavos<>0 or v_f.repasse_status in ('concluido','repassado','bloqueado')
   or v_a.status in ('cancelado','contestado') or v_a.concluido_em is null then
     return jsonb_build_object('ok',false,'reason','repasse_bloqueado');
  end if;
  select * into v_k from public.qf_livre_pix_chaves where profissional_id=v_r.profissional_id;
  if not found or v_k.chave_pix is distinct from v_r.pix_chave or v_k.status<>'validado' then
     return jsonb_build_object('ok',false,'reason','validar_chave_pix');
  end if;
  if coalesce(length(trim(p_referencia)),0)<8 or coalesce(length(trim(p_comprovante)),0)<8
   or length(trim(p_referencia))>150 or length(trim(p_comprovante))>500 then
    return jsonb_build_object('ok',false,'reason','exigir_referencia_e_comprovante');
  end if;
  update public.qf_repasses_manuais set status='pago',
    pago_em=now(),aprovado_por=v_uid,atualizado_em=now(),
    pix_end_to_end_id=trim(p_referencia),comprovante_ref=trim(p_comprovante),
    observacao=left(p_observacao,1500) where id=p_repasse_id;
  -- Baixa uma única vez a obrigação na fonte do pagamento. O banco já foi
  -- movimentado manualmente; estas atualizações NÃO iniciam transferência.
  update public.qf_comissao13_financeiro set repasse_status='concluido',repassado_em=now()
  where id=v_f.id;
  update public.qf_comissao13_acordos set status='repassado',repassado_em=now()
  where id=v_a.id;
 else
  if p_acao='bloquear' and coalesce(length(trim(p_observacao)),0)<8 then
    return jsonb_build_object('ok',false,'reason','motivo_obrigatorio');
  end if;
  update public.qf_repasses_manuais set status=case when p_acao='bloquear' then 'bloqueado' else 'em_analise' end,
    observacao=left(p_observacao,1500),atualizado_em=now(),aprovado_por=v_uid where id=p_repasse_id;
 end if;
 insert into public.qf_repasses_manuais_eventos(repasse_id,ator,tipo,detalhe) values
 (p_repasse_id,v_uid,p_acao,jsonb_build_object('referencia',case when p_acao='confirmar' then trim(p_referencia) else null end,'observacao',left(p_observacao,1500)));
 return jsonb_build_object('ok',true,'status',case when p_acao='confirmar' then 'pago' when p_acao='bloquear' then 'bloqueado' else 'em_analise' end);
end;
$$;
revoke execute on function public.qf_repasses_manuais_admin(uuid,text,text,text,text) from public,anon;
grant execute on function public.qf_repasses_manuais_admin(uuid,text,text,text,text) to authenticated;
