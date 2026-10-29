-- Plano Livre: pedido formal de saque antes de repasse manual pelo administrador.
alter table private.qf_livre_manual_pix add column if not exists saque_solicitado_em timestamptz;
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
 if v.saque_solicitado_em is not null
 then return jsonb_build_object('ok',true,'duplicado',true,'solicitado_em',v.saque_solicitado_em);end if;
 select * into v_k from public.qf_livre_pix_chaves where profissional_id=v.profissional_id;
 if not found or length(trim(v_k.chave_pix))<5 then
 return jsonb_build_object('ok',false,'reason','chave_pix_ausente');end if;
 update private.qf_livre_manual_pix set saque_solicitado_em=now(),atualizado_em=now()
 where id=v.id;
 return jsonb_build_object('ok',true,'solicitado',true,'profissional_centavos',v.profissional_centavos);
end $saque$;
CREATE OR REPLACE FUNCTION public.qf_livre_manual_pix_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid:=auth.uid(); v_admin boolean;
begin
 if v_uid is null then return '[]'::jsonb;end if;
 v_admin:=private.qf_is_admin();
 return (select coalesce(jsonb_agg(jsonb_build_object(
 'id',v.id,'fechamento_id',v.fechamento_id,'chamado_id',v.chamado_id,
 'profissional_id',v.profissional_id,'profissional',p.nome,'valor_centavos',v.valor_centavos,
 'comissao_centavos',v.comissao_centavos,'profissional_centavos',v.profissional_centavos,
 'status',v.status,'confirmado_em',v.confirmado_em,'repassado_em',v.repassado_em,
 'saque_solicitado_em',v.saque_solicitado_em,
 'pix_chave',case when v_admin then k.chave_pix else null end,
 'repasse_comprovante',case when v_admin then v.repasse_comprovante else null end
 ) order by v.criado_em desc),'[]'::jsonb)
 from private.qf_livre_manual_pix v
 join public.qf_profiles p on p.id=v.profissional_id
 left join public.qf_livre_pix_chaves k on k.profissional_id=v.profissional_id
 where v_admin or v.profissional_id=v_uid);
end $function$
;
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
 select * into k from public.qf_livre_pix_chaves where profissional_id=v.profissional_id;
 if not found or length(trim(k.chave_pix))<5
 then return jsonb_build_object('ok',false,'reason','chave_pix_ausente');end if;
 -- A movimentação financeira é EXTERNA e MANUAL; este RPC só registra comprovante.
 update private.qf_livre_manual_pix set status='repassado',repassado_em=now(),
 repasse_admin=auth.uid(),repasse_referencia=left(trim(p_referencia),150),
 repasse_comprovante=left(trim(p_comprovante),500),atualizado_em=now() where id=v.id;
 return jsonb_build_object('ok',true,'status','repassado','profissional_centavos',v.profissional_centavos);
end $function$
;
revoke all on function public.qf_livre_manual_pix_solicitar(uuid) from public,anon;
grant execute on function public.qf_livre_manual_pix_solicitar(uuid) to authenticated;
