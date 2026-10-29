create or replace function private.qf_livre_status_beneficio() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb; b private.qf_livre_beneficios; extras jsonb; prefer text;
begin
 if auth.uid() is null then return jsonb_build_object('ok',false); end if;
 s:=public.qf_livre_status_pago();
 select modalidade_preferida into prefer from public.qf_profissionais where user_id=auth.uid();
 extras:=jsonb_build_object('preferencia',coalesce(prefer,'livre'),'servidor_agora',clock_timestamp(),
  'identificado',private.qf_livre_identificado(auth.uid()),
  'pacotes_ativos',coalesce((select jsonb_agg(jsonb_build_object('plano',plano,'restantes',chamados_restantes,
   'inicio_em',criado_em,'valido_ate',valido_ate)) from public.qf_planos_profissional
   where profissional_id=auth.uid() and plano<>'livre' and valido_ate>now() and chamados_restantes>0),'[]'::jsonb),
  'teste_utilizado',exists(select 1 from private.qf_livre_beneficios where user_id=auth.uid() and tipo='teste'));
 if coalesce((s->>'ativo')::boolean,false) then
  return s||extras||jsonb_build_object('tipo_acesso','pago','duracao_dias',30,'aguarda_identificacao',false);
 end if;
 select * into b from private.qf_livre_beneficios where user_id=auth.uid() and encerrado_em is null
 order by coalesce(inicio_em<=now() and fim_em>clock_timestamp(),false) desc,
  (inicio_em is null) desc,fim_em desc nulls last limit 1;
 if b.id is not null and (b.inicio_em is null or b.fim_em>clock_timestamp()
  or s->>'valido_ate' is null or b.fim_em>=(s->>'valido_ate')::timestamptz) then
  return s||extras||jsonb_build_object('ativo',coalesce(b.inicio_em<=now() and b.fim_em>clock_timestamp(),false),
   'tipo_acesso',b.tipo,'duracao_dias',b.dias,'inicio_em',b.inicio_em,'valido_ate',b.fim_em,
   'aguarda_identificacao',b.inicio_em is null,'teste_vencido',b.tipo='teste' and b.fim_em<=clock_timestamp());
 end if;
 return s||extras||jsonb_build_object('tipo_acesso',case when s->>'assinatura_id' is not null then 'pago' else null end,
  'duracao_dias',30,'aguarda_identificacao',false,'teste_vencido',false);
end $$;
