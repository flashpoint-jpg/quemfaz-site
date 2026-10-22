-- Recovery checkpoints reuse the existing eligible-recipient / delivery reservation path.
-- No wallet, payment, order, price or notification-radius changes.
create table private.qf_pedido_recuperacoes (
 chamado_id uuid not null references public.qf_chamados(id) on delete cascade,
 etapa_minutos integer not null check (etapa_minutos in (10,30,120,1440)),
 verificado_em timestamptz not null default now(),
 elegiveis integer not null,
 resultado text not null,
 primary key(chamado_id,etapa_minutos)
);
alter table private.qf_pedido_recuperacoes enable row level security;
revoke all on private.qf_pedido_recuperacoes from public,anon,authenticated;

create function private.qf_recuperar_pedidos_sem_desbloqueio()
returns integer language plpgsql security definer set search_path='' as $$
declare r record; v_etapa integer; v_elegiveis integer; v_n integer:=0; v_inserted integer;
begin
 for r in
  select c.id, greatest(c.criado_em,coalesce(c.data_preferida-interval '24 hours',c.criado_em)) inicio
  from public.qf_chamados c
  where c.status='aberto'
   and greatest(c.criado_em,coalesce(c.data_preferida-interval '24 hours',c.criado_em))>=now()-interval '3 days'
   and greatest(c.criado_em,coalesce(c.data_preferida-interval '24 hours',c.criado_em))<=now()-interval '10 minutes'
   and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id)
   and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
   and exists(select 1 from unnest(array[10,30,120,1440]) s(m)
    where greatest(c.criado_em,coalesce(c.data_preferida-interval '24 hours',c.criado_em))<=now()-make_interval(mins=>s.m)
    and not exists(select 1 from private.qf_pedido_recuperacoes h where h.chamado_id=c.id and h.etapa_minutos=s.m))
  order by c.criado_em desc limit 25 for update of c skip locked
 loop
  -- A late scheduler records all overdue checkpoints but dispatches only once.
  select max(s.m) into v_etapa from unnest(array[10,30,120,1440]) s(m)
   where r.inicio<=now()-make_interval(mins=>s.m)
   and not exists(select 1 from private.qf_pedido_recuperacoes h where h.chamado_id=r.id and h.etapa_minutos=s.m);
  select count(*) into v_elegiveis from public.qf_chamado_destinatarios_alcance(r.id,200);
  insert into private.qf_pedido_recuperacoes(chamado_id,etapa_minutos,elegiveis,resultado)
   select r.id,s.m,v_elegiveis,case when s.m<>v_etapa then 'verificacao_atrasada'
    when v_elegiveis=0 then 'sem_elegiveis_agora' else 'reavaliacao_solicitada' end
   from unnest(array[10,30,120,1440]) s(m) where r.inicio<=now()-make_interval(mins=>s.m)
   on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted>0 then
   if v_elegiveis>0 then perform private.qf_push_interno('retry_call',r.id); end if;
   v_n:=v_n+1;
  end if;
 end loop;
 return v_n;
end $$;
revoke all on function private.qf_recuperar_pedidos_sem_desbloqueio() from public,anon,authenticated;

create function public.qf_admin_funil_comercial()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
 if auth.uid() is null or not coalesce(private.qf_is_admin(),false) then
  return jsonb_build_object('ok',false,'reason','sem_permissao');
 end if;
 with pedidos as (
  select c.*,public.qf_limite_orcamentos(c.id) limite,
   (select count(*) from public.qf_desbloqueios d where d.chamado_id=c.id and coalesce(d.ativo,true)) desbloqueios,
   coalesce((select p.preco_centavos from public.qf_precos_desbloqueio p where p.categoria=c.categoria and p.ativo),
    (select p.preco_centavos from public.qf_precos_desbloqueio p where p.categoria='padrao'),790) preco
  from public.qf_chamados c where c.status in ('aberto','em_negociacao')
 ), aptos as (
  select c.id,pr.user_id,pr.online,private.qf_dentro_horario(pr.horario_inicio,pr.horario_fim) no_horario,
   (coalesce(w.saldo_centavos,0)>=c.preco or exists(select 1 from public.qf_planos_profissional pl
    where pl.profissional_id=pr.user_id and pl.valido_ate>now() and pl.chamados_restantes>0)) pode_desbloquear,
   exists(select 1 from public.qf_push_subscriptions s where s.user_id=pr.user_id and s.ativo) push_ativo
  from pedidos c cross join lateral public.qf_cascata_destinatarios(c.id) a
  join public.qf_profissionais pr on pr.user_id=a.user_id
  left join public.qf_carteiras w on w.profissional_id=pr.user_id
  where private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
 ), diagnostico as (
  select c.id,c.categoria,c.criado_em,c.status,c.desbloqueios,c.limite,c.preco,
   count(a.user_id) aptos_raio,
   count(a.user_id) filter(where a.online and a.no_horario) aptos_online_horario,
   count(a.user_id) filter(where a.pode_desbloquear) aptos_com_credito_ou_plano,
   count(a.user_id) filter(where a.online and a.no_horario and a.push_ativo) aptos_com_push,
   (select count(distinct e.user_id) from public.qf_push_entregas e where e.chamado_id=c.id and e.envio_status='enviado') enviados
  from pedidos c left join aptos a on a.id=c.id
  group by c.id,c.categoria,c.criado_em,c.status,c.desbloqueios,c.limite,c.preco
 ), recursos as (
  select pr.user_id,coalesce(w.saldo_centavos,0) saldo,
   coalesce((select min(coalesce(pd.preco_centavos,(select preco_centavos from public.qf_precos_desbloqueio where categoria='padrao'),790))
    from unnest(pr.especialidades) cat left join public.qf_precos_desbloqueio pd on pd.categoria=cat and pd.ativo),800) menor_preco,
   exists(select 1 from public.qf_planos_profissional pl where pl.profissional_id=pr.user_id and pl.valido_ate>now() and pl.chamados_restantes>0) plano
  from public.qf_profissionais pr left join public.qf_carteiras w on w.profissional_id=pr.user_id
 ), publicacoes as (
  select c.id,c.criado_em from public.qf_chamados c
  where c.status in ('aberto','em_negociacao','concluido','cancelado','expirado')
 )
 select jsonb_build_object('ok',true,'gerado_em',now(),
 'pedidos_ativos',coalesce((select jsonb_object_agg(n::text,total) from (
  select desbloqueios n,count(*) total from pedidos group by desbloqueios) x),'{}'::jsonb),
 'publicacoes_dia',coalesce((select jsonb_agg(x order by dia desc) from (
  select (criado_em at time zone 'America/Sao_Paulo')::date dia,count(*) total
  from publicacoes where criado_em>=now()-interval '7 days' group by 1) x),'[]'::jsonb),
 'carteiras',(select jsonb_build_object('saldo_positivo',count(*) filter(where saldo>0),
  'saldo_suficiente_minimo',count(*) filter(where saldo>=menor_preco),
  'saldo_insuficiente_minimo',count(*) filter(where saldo<menor_preco),
  'plano_ativo',count(*) filter(where plano)) from recursos),
 'recargas',(select jsonb_build_object('aprovadas_banco',count(*) filter(where status='aprovado'),
  'valor_aprovado_centavos',coalesce(sum(valor_centavos) filter(where status='aprovado'),0),
  'pendentes',count(*) filter(where status='pendente')) from public.qf_recargas),
 'notificacoes',coalesce((select jsonb_object_agg(envio_status,total) from (
  select envio_status,count(*) total from public.qf_push_entregas group by envio_status) x),'{}'::jsonb),
 'recuperacoes',coalesce((select jsonb_agg(x) from (
  select etapa_minutos,resultado,count(*) total from private.qf_pedido_recuperacoes group by 1,2) x),'[]'::jsonb),
 'pedidos',coalesce((select jsonb_agg(d order by d.criado_em desc) from diagnostico d),'[]'::jsonb),
 'custo_por_pedido',null,'google_ads_status','Dados de custo e atribuição do Google Ads indisponíveis neste painel',
 'pagamentos_status','Aprovações registradas no banco; conciliação independente com o provedor não executada') into v_result;
 return v_result;
end $$;
revoke all on function public.qf_admin_funil_comercial() from public,anon;
grant execute on function public.qf_admin_funil_comercial() to authenticated;

select cron.schedule('qf-recuperacao-comercial','* * * * *','select private.qf_recuperar_pedidos_sem_desbloqueio();');
