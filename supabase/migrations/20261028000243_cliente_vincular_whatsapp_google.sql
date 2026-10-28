begin;
-- Aditivo. Só vincula o WhatsApp do pedido à conta Google do próprio cliente quando a conta ainda não tem telefone
-- e ninguém mais usa o número (índice único qf_profiles_cliente_telefone_unico). Não cria sessão nem altera contas existentes.
create or replace function public.qf_cliente_vincular_whatsapp(p_whatsapp text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_norm text; p public.qf_profiles; v_cur text;
begin
 if v_uid is null then return jsonb_build_object('ok',false,'reason','autenticacao_obrigatoria'); end if;
 if not exists(select 1 from auth.identities where user_id=v_uid and provider='google') then
  return jsonb_build_object('ok',false,'reason','somente_google'); end if;
 v_norm:=public.qf_normalizar_whatsapp(p_whatsapp);
 if length(v_norm) not between 10 and 11 then return jsonb_build_object('ok',false,'reason','telefone_invalido'); end if;
 select * into p from public.qf_profiles where id=v_uid for update;
 if not found or p.tipo<>'cliente' then return jsonb_build_object('ok',false,'reason','perfil_invalido'); end if;
 v_cur:=public.qf_normalizar_whatsapp(coalesce(nullif(p.whatsapp,''),p.telefone));
 if v_cur<>'' then
  return jsonb_build_object('ok',v_cur=v_norm,'reason',case when v_cur=v_norm then 'ja_vinculado' else 'telefone_diferente' end);
 end if;
 begin
  update public.qf_profiles set whatsapp=v_norm,telefone=v_norm where id=v_uid;
 exception when unique_violation then
  return jsonb_build_object('ok',false,'reason','telefone_em_uso');
 end;
 return jsonb_build_object('ok',true,'reason','vinculado');
end $$;
revoke all on function public.qf_cliente_vincular_whatsapp(text) from public,anon;
grant execute on function public.qf_cliente_vincular_whatsapp(text) to authenticated;
commit;
