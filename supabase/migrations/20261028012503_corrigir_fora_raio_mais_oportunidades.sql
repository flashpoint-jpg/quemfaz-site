create or replace function public.qf_mais_oportunidades()
 returns table(id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text, endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone, prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric, raio_atual_km integer, preco_centavos integer, tempo_min integer, participantes integer, limite integer, fora_raio boolean)
 language sql
 stable
 security definer
 set search_path to ''
as $function$
with profissional as (
  select pr.user_id,pr.especialidades,pr.online,pr.latitude pro_latitude,pr.longitude pro_longitude,
  coalesce(pr.raio_km,20)::integer raio_configurado_km
  from public.qf_profissionais pr
  where pr.user_id=auth.uid()
  and exists(select 1 from public.qf_profiles pf where pf.id=pr.user_id and coalesce(pf.ativo,true))
  and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
), base as (
select c.id,c.categoria,c.titulo,public.qf_ocultar_contato(c.descricao) descricao,c.cidade,c.uf,c.bairro,
round(g.latitude,2) latitude,round(g.longitude,2) longitude,c.data_preferida,c.prioridade,c.criado_em,
public.qf_distancia_km(p.pro_latitude,p.pro_longitude,g.latitude,g.longitude) distancia_bruta,
p.raio_configurado_km,
(case when private.qf_cortesia_reativacao_20261022(c.id) then 0 else coalesce(pd.preco_centavos,padrao.preco_centavos,790) end) preco,
(select count(*) from public.qf_desbloqueios x where x.chamado_id=c.id and coalesce(x.ativo,true)) participantes,
public.qf_limite_orcamentos(c.id) limite
from public.qf_chamados c cross join profissional p
left join lateral private.qf_chamado_centro(c.id) g on true
left join public.qf_precos_desbloqueio pd on pd.categoria=c.categoria and pd.ativo
left join public.qf_precos_desbloqueio padrao on padrao.categoria='padrao'
where c.status in ('aberto','em_negociacao') and not private.qf_pedido_expiravel_72h(c)
and c.categoria = any(coalesce(p.especialidades,array[]::text[]))
and not exists(select 1 from public.qf_orcamentos o where o.chamado_id=c.id and o.status='aceito')
and (select count(*) from public.qf_desbloqueios dx where dx.chamado_id=c.id and coalesce(dx.ativo,true)) < public.qf_limite_orcamentos(c.id)
and c.cliente_id is distinct from p.user_id
and not exists(select 1 from public.qf_desbloqueios d where d.chamado_id=c.id and d.profissional_id=p.user_id)
)
select id,categoria,titulo,descricao,cidade,uf,bairro,null::text endereco_completo,latitude,longitude,data_preferida,prioridade,criado_em,'aberto'::text status,
case when distancia_bruta is null then null else round(distancia_bruta,1) end distancia_km,
raio_configurado_km raio_atual_km,preco::integer preco_centavos,
public.qf_tempo_estimado_min(distancia_bruta) tempo_min,participantes::integer participantes,limite::integer limite,
coalesce(distancia_bruta is null or distancia_bruta > raio_configurado_km, true) fora_raio
from base
order by criado_em desc
$function$;