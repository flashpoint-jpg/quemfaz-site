begin;
-- A identificação usa a mesma assinatura paga e a mesma janela de vigência do desbloqueio.
create or replace function private.qf_livre_identificacao(p_profissional uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id
 where a.profissional_id=p_profissional and a.inicio_em<=now() and a.fim_em>now() and r.status='aprovado');
$$;
revoke all on function private.qf_livre_identificacao(uuid) from public,anon,authenticated;

create or replace function public.qf_admin_planos_profissionais()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.qf_is_admin() then raise exception 'forbidden'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc) from (
 select pp.profissional_id,pp.plano,pp.chamados_total,pp.chamados_restantes,pp.valido_ate,pp.criado_em,pp.recarga_id,null::timestamptz as inicio_em
 from public.qf_planos_profissional pp
 union all
 select a.profissional_id,'livre',null::integer,null::integer,a.fim_em,a.criado_em,a.recarga_id,a.inicio_em
 from public.qf_livre_assinaturas a join public.qf_recargas r on r.id=a.recarga_id where r.status='aprovado'
 ) x),'[]'::jsonb);
end $$;

-- As consultas públicas continuam limitadas pelo token da carteirinha ou pelo segredo do pedido.
do $$declare f text; old text; novo text; fn regprocedure; begin
 foreach fn in array array['public.qf_carteirinha_publica(uuid)'::regprocedure,'public.qf_carteirinha_publica_v2(uuid)'::regprocedure] loop
  f:=pg_get_functiondef(fn);
  if position('plano_livre_ativo' in f)>0 then continue;end if;
  old:='''foto'',p.foto_url';
  if position(old in f)=0 then old:='''foto'', p.foto_url'; end if;
  novo:=old||', ''plano_livre_ativo'', private.qf_livre_identificacao(p.id)';
  if position(old in f)=0 then raise exception 'Marcador ausente: %',fn;end if;
  execute replace(f,old,novo);
 end loop;
 f:=pg_get_functiondef('public.qf13_acompanhar(uuid,text,text,uuid,boolean)'::regprocedure);
 old:='''profissional'',p.nome';
 if position(old in f)=0 then raise exception 'Marcador acompanhamento ausente';end if;
 if position('plano_livre_ativo' in f)=0 then
  execute replace(f,old,old||',''plano_livre_ativo'',private.qf_livre_identificacao(f0.profissional_id)');
 end if;
end $$;

-- Preserva o contrato do RPC antigo e sua verificação de propriedade do pedido.
create or replace function private.qf_cliente_conversas_livre(p_chamado_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('plano_livre_ativo',private.qf_livre_identificacao(c.profissional_id))),'[]'::jsonb)
 from public.qf_cliente_conversas(p_chamado_id) c where auth.uid() is not null;
$$;
revoke all on function private.qf_cliente_conversas_livre(uuid) from public,anon;
grant execute on function private.qf_cliente_conversas_livre(uuid) to authenticated;
create or replace function public.qf_cliente_conversas_livre(p_chamado_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select private.qf_cliente_conversas_livre(p_chamado_id)$$;
revoke all on function public.qf_cliente_conversas_livre(uuid) from public,anon;
grant execute on function public.qf_cliente_conversas_livre(uuid) to authenticated;
commit;
