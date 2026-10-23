-- Cancelamento do pedido pelo dono identificado pelo segredo de 256 bits (mesmo mecanismo de qf13_acompanhar),
-- para a página de acompanhamento funcionar sem conta, após atualizar a página.
create or replace function public.qf13_cancelar_pedido(p_chamado_id uuid, p_segredo text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare k private.qf13_codigos_pedido; v_status text; v_desbloqueios integer;
begin
 if p_segredo is null or p_segredo !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok',false,'reason','acesso_invalido'); end if;
 select * into k from private.qf13_codigos_pedido where chamado_id=p_chamado_id and proprietario_hash=encode(extensions.digest(p_segredo,'sha256'),'hex');
 if not found then return jsonb_build_object('ok',false,'reason','acesso_invalido'); end if;
 select status into v_status from public.qf_chamados where id=p_chamado_id for update;
 if v_status in ('cancelado','cancelada') then return jsonb_build_object('ok',true,'ja_cancelado',true); end if;
 select count(*) into v_desbloqueios from public.qf_desbloqueios where chamado_id=p_chamado_id and ativo=true;
 if v_desbloqueios>0 then return jsonb_build_object('ok',false,'reason','ja_desbloqueado'); end if;
 update public.qf_chamados set status='cancelado',atualizado_em=now() where id=p_chamado_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.qf13_cancelar_pedido(uuid,text) from public;
grant execute on function public.qf13_cancelar_pedido(uuid,text) to anon, authenticated;
