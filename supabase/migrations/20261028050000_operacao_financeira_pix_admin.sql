-- Leitura administrativa; não cria cobranças, não valida titularidade e não envia dinheiro.
create or replace function private.qf_operacao_financeira_admin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not private.qf_is_admin() then
  raise exception 'admin authentication required' using errcode='42501';
 end if;
 return jsonb_build_object(
  'gerado_em',now(),
  'pagamento_pos_servico',jsonb_build_object('habilitado',false,'homologado',false,
   'observacao','Repasse para qualquer banco em homologação. Não emitir pagamentos reais.'),
  'pedidos',coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc) from (
   select c.id,c.status,c.titulo,c.categoria,c.cidade,c.criado_em,cl.nome as cliente,
    c.marketing_origem->>'source' as origem,c.marketing_origem->>'campaign' as campanha
   from public.qf_chamados c left join public.qf_profiles cl on cl.id=c.cliente_id
  ) x),'[]'::jsonb),
  'chaves',coalesce((select jsonb_agg(to_jsonb(x) order by x.nome) from (
   select pro.user_id as profissional_id,p.nome,p.cidade,p.uf,p.ativo,pro.especialidades,pro.raio_km,
    pro.horario_inicio,pro.horario_fim,k.chave_pix,coalesce(k.status,'nao_cadastrado') as status,k.atualizado_em,
    exists(select 1 from public.qf_livre_assinaturas a where a.profissional_id=pro.user_id
      and a.inicio_em<=now() and a.fim_em>now()) as livre_ativo
   from public.qf_profissionais pro join public.qf_profiles p on p.id=pro.user_id
   left join public.qf_livre_pix_chaves k on k.profissional_id=pro.user_id
  ) x),'[]'::jsonb),
  'pagamentos',coalesce((select jsonb_agg(to_jsonb(x) order by x.criado_em desc) from (
   select sp.chamado_id,sp.profissional_id,sp.status,sp.valor_centavos,sp.profissional_centavos,
    sp.plataforma_centavos,sp.txid,sp.end_to_end_id,sp.confirmado_em,sp.repassado_em,sp.erro,sp.criado_em
   from private.qf_livre_split_pagamentos sp
  ) x),'[]'::jsonb),
  'leads',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
   select id,created_at,event,source,campaign,category,request_id from public.qf_client_funnel
   where event='published' and not teste order by created_at desc limit 10
  ) x),'[]'::jsonb)
 );
end $$;
revoke all on function private.qf_operacao_financeira_admin() from public,anon;
grant execute on function private.qf_operacao_financeira_admin() to authenticated;
create or replace function public.qf_operacao_financeira_admin()
returns jsonb language sql stable security invoker set search_path = '' as $$
 select private.qf_operacao_financeira_admin()
$$;
revoke all on function public.qf_operacao_financeira_admin() from public,anon;
grant execute on function public.qf_operacao_financeira_admin() to authenticated;
