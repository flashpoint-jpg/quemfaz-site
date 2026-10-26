-- Observabilidade de exibição: não altera elegibilidade, valores ou dados financeiros.
create table private.qf_pedidos_exibidos (
 profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
 chamado_id uuid not null references public.qf_chamados(id) on delete cascade,
 primeiro_em timestamptz not null default now(),
 ultimo_em timestamptz not null default now(),
 primary key(profissional_id,chamado_id)
);
create index qf_pedidos_exibidos_chamado_idx on private.qf_pedidos_exibidos(chamado_id);
alter table private.qf_pedidos_exibidos enable row level security;
revoke all on private.qf_pedidos_exibidos from public,anon,authenticated;

create or replace function public.qf_registrar_pedidos_exibidos(p_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_total integer;
begin
 if v_uid is null then return 0; end if;
 -- IDs são sempre validados nas mesmas consultas que autorizam a lista do app.
 with elegiveis as (
  select id from public.qf_portfolio_servicos()
  union select id from public.qf_mais_oportunidades()
 ), alvo as (select distinct id from unnest(p_ids[1:100]) id)
 insert into private.qf_pedidos_exibidos(profissional_id,chamado_id)
 select v_uid,e.id from elegiveis e join alvo a on a.id=e.id
 on conflict(profissional_id,chamado_id) do update set ultimo_em=now();
 get diagnostics v_total=row_count;
 return v_total;
end $$;
revoke all on function public.qf_registrar_pedidos_exibidos(uuid[]) from public,anon;
grant execute on function public.qf_registrar_pedidos_exibidos(uuid[]) to authenticated;

create or replace function public.qf_admin_profissional_entregas(p_profissional_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_prof jsonb; v_feed jsonb; v_ant text; v_mais integer; v_totais jsonb;
begin
 if auth.uid() is null or not private.qf_is_admin() then
  return jsonb_build_object('ok',false,'reason','sem_permissao');
 end if;
 select jsonb_build_object('id',p.id,'nome',p.nome,'ativo',p.ativo,'cidade',p.cidade,'uf',p.uf,
  'profissoes',pr.especialidades,'raio_km',pr.raio_km,'horario_inicio',pr.horario_inicio,'horario_fim',pr.horario_fim,
  'no_horario',private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim),
  'cidades',coalesce((select jsonb_agg(jsonb_build_object('cidade',a.cidade,'uf',a.uf,'raio_km',a.raio_km)) from public.qf_profissional_cidades a where a.profissional_id=p.id),'[]'::jsonb),
  'livre_ate',(select max(fim_em) from public.qf_livre_assinaturas a where a.profissional_id=p.id and a.inicio_em<=now() and a.fim_em>now()),
  'outros_planos',coalesce((select jsonb_agg(jsonb_build_object('plano',a.plano,'valido_ate',a.valido_ate,'restantes',a.chamados_restantes)) from public.qf_planos_profissional a where a.profissional_id=p.id and a.valido_ate>now() and a.chamados_restantes>0),'[]'::jsonb)
 ) into v_prof from public.qf_profiles p join public.qf_profissionais pr on pr.user_id=p.id where p.id=p_profissional_id;
 if v_prof is null then return jsonb_build_object('ok',false,'reason','profissional_nao_encontrado'); end if;
 -- A identidade temporária só é usada pelas consultas do próprio feed; restaurada antes da resposta.
 v_ant:=current_setting('request.jwt.claim.sub',true);
 perform set_config('request.jwt.claim.sub',p_profissional_id::text,true);
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'titulo',x.titulo,'cidade',x.cidade,'bairro',x.bairro,'distancia_km',x.distancia_km,'participantes',x.participantes,'limite',x.limite)),'[]'::jsonb) into v_feed from public.qf_portfolio_servicos() x;
 select count(*) into v_mais from public.qf_mais_oportunidades();
 perform set_config('request.jwt.claim.sub',coalesce(v_ant,''),true);
 select jsonb_build_object(
  'exibidos',(select count(*) from private.qf_pedidos_exibidos e where e.profissional_id=p_profissional_id),
  'notificados',(select count(distinct e.chamado_id) from public.qf_push_entregas e where e.user_id=p_profissional_id and e.evento='new_call' and e.envio_status='enviado'),
  'distribuidos',(select count(distinct e.chamado_id) from public.qf_push_entregas e where e.user_id=p_profissional_id and e.evento='new_call'),
  'desbloqueados',(select count(distinct d.chamado_id) from public.qf_desbloqueios d where d.profissional_id=p_profissional_id),
  'orcamentos_aceitos',(select count(distinct o.chamado_id) from public.qf_orcamentos o where o.profissional_id=p_profissional_id and o.status='aceito'),
  'finalizados',(select count(distinct c.id) from public.qf_chamados c where c.status in ('concluido','finalizado') and (exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.profissional_id=p_profissional_id and o.status='aceito') or exists(select 1 from public.qf_comissao13_fechamentos f where f.chamado_id=c.id and f.profissional_id=p_profissional_id and f.cliente_concluiu_em is not null)))
 ) into v_totais;
 return jsonb_build_object('ok',true,'profissional',v_prof,'compativeis',v_feed,'mais_oportunidades',v_mais,'totais',v_totais,'medicao_exibidos_desde','2026-10-26','gerado_em',now());
end $$;
revoke all on function public.qf_admin_profissional_entregas(uuid) from public,anon;
grant execute on function public.qf_admin_profissional_entregas(uuid) to authenticated;

-- Diagnóstico antigo não deve excluir profissional por Online manual.
do $patch$
declare v_def text;
begin
 v_def:=pg_get_functiondef('public.qf_admin_push_diagnostico(uuid)'::regprocedure);
 v_def:=replace(v_def, E'        when not b.online then ''offline''\n','');
 execute v_def;
end $patch$;
