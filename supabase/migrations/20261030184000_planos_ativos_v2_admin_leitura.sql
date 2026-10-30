-- Consulta administrativa somente leitura: planos ativos e vencimentos.
-- Depende da migration inerte da primeira fase, sem afetar vendas ou desbloqueios.
create or replace function public.qf_admin_planos_ativos_v2()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare listagem jsonb;
begin
 if not private.qf_is_admin() then
   return jsonb_build_object('ok',false,'reason','sem_permissao');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'profissional_id',x.profissional_id,
   'nome',x.nome,
   'plano',x.plano,
   'origem',x.origem,
   'pagamento_em',x.pagamento_em,
   'inicio_em',x.inicio_em,
   'vencimento_em',x.vencimento_em,
   'chamados_restantes',x.chamados_restantes,
   'vence_em_7_dias',x.vencimento_em<=now()+interval '7 days'
 ) order by x.vencimento_em asc),'[]'::jsonb)
 into listagem from (
   select a.profissional_id,p.nome,'livre_legado'::text plano,'assinatura_legada'::text origem,
     r.aprovado_em pagamento_em,a.inicio_em,a.fim_em vencimento_em,null::integer chamados_restantes
   from public.qf_livre_assinaturas a
   join public.qf_recargas r on r.id=a.recarga_id and r.status='aprovado'
   join public.qf_profiles p on p.id=a.profissional_id
   where a.fim_em>now()
   union all
   select pp.profissional_id,p.nome,pp.plano,'pacote_legado',
     r.aprovado_em,pp.criado_em,pp.valido_ate,pp.chamados_restantes
   from public.qf_planos_profissional pp
   join public.qf_profiles p on p.id=pp.profissional_id
   left join public.qf_recargas r on r.id=pp.recarga_id and r.status='aprovado'
   where pp.valido_ate>now() and (pp.origem='manual' or r.id is not null)
   union all
   select a.profissional_id,p.nome,a.codigo,'v2_paga',
     a.pagamento_confirmado_em,a.inicio_em,a.fim_em,
     greatest(0,a.cota_contratada-(select count(*)::integer
       from private.qf_planos_v2_consumos c where c.assinatura_id=a.id))
   from private.qf_planos_v2_assinaturas a
   join public.qf_profiles p on p.id=a.profissional_id
   join public.qf_recargas r on r.id=a.recarga_id and r.status='aprovado'
   where a.status='pago' and a.fim_em>now()
 ) x;
 return jsonb_build_object('ok',true,'total',jsonb_array_length(listagem),'planos',listagem);
end $$;
revoke all on function public.qf_admin_planos_ativos_v2() from public,anon,authenticated;
grant execute on function public.qf_admin_planos_ativos_v2() to authenticated, service_role;
