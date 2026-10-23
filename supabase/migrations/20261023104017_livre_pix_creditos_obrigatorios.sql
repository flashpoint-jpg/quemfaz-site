-- Novos contatos exigem assinatura paga ou créditos; fechamentos existentes permanecem intactos.
-- Clientes antigos que chamam o RPC de grátis passam pela mesma validação do Livre.
create or replace function public.qf_comissao13_desbloquear(p_chamado_id uuid,p_aceitar boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select private.qf_livre_desbloquear(p_chamado_id,p_aceitar)
$$;
revoke all on function public.qf_comissao13_desbloquear(uuid,boolean) from public,anon;
grant execute on function public.qf_comissao13_desbloquear(uuid,boolean) to authenticated;

create or replace function public.qf_comissao13_status()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return jsonb_build_object('ok',false);end if;
 return jsonb_build_object('ok',true,'comissao_percentual',13,'desbloqueio_gratuito_ativo',false,'bloqueio',private.qf13_bloqueio(auth.uid()));
end $$;
revoke all on function public.qf_comissao13_status() from public,anon;
grant execute on function public.qf_comissao13_status() to authenticated;

-- Encerra novas utilizações da cortesia anterior, sem revogar contatos já liberados.
create or replace function private.qf_cortesia_reativacao_20261022(p_chamado_id uuid)
returns boolean language sql stable security definer set search_path='' as $$select false$$;
revoke all on function private.qf_cortesia_reativacao_20261022(uuid) from public,anon,authenticated;
-- Fila de notificações, prestação de contas e comissões do Livre continuam ativas.
