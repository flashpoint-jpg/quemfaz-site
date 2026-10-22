-- Distancia aproximada em linha reta na aba Outros pedidos. Manter interface antiga intacta.
CREATE OR REPLACE FUNCTION public.qf_outros_pedidos_vitrine_v2()
 RETURNS TABLE(id uuid, categoria text, titulo text, cidade text, uf character, bairro text, criado_em timestamp with time zone, data_preferida timestamp with time zone, prioridade boolean, participantes integer, limite integer, vagas integer, distancia_km numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    c.id,
    c.categoria,
    c.titulo,
    c.cidade,
    c.uf,
    c.bairro,
    c.criado_em,
    c.data_preferida,
    coalesce(c.prioridade,false),
    d.ocupadas,
    public.qf_limite_orcamentos(c.id),
    greatest(0,public.qf_limite_orcamentos(c.id)-d.ocupadas),
    case
      when c.latitude is not null and c.longitude is not null
        and loc.latitude is not null and loc.longitude is not null
      then round(public.qf_distancia_km(loc.latitude, loc.longitude, c.latitude, c.longitude),1)
      else null::numeric
    end as distancia_km
  from public.qf_profissionais pr
  join public.qf_profiles pf on pf.id=pr.user_id and coalesce(pf.ativo,true)
  left join lateral (
    select pc.latitude,pc.longitude
    from public.qf_profissional_cidades pc
    where pc.profissional_id=pr.user_id
      and pc.latitude is not null and pc.longitude is not null
    order by pc.criado_em desc limit 1
  ) area on true
  cross join lateral (
    select
      case when pr.latitude is not null and pr.longitude is not null
        then pr.latitude else area.latitude end as latitude,
      case when pr.latitude is not null and pr.longitude is not null
        then pr.longitude else area.longitude end as longitude
  ) loc
  join public.qf_chamados c on true
  cross join lateral (
    select count(*)::integer as ocupadas
    from public.qf_desbloqueios dx
    where dx.chamado_id=c.id and coalesce(dx.ativo,true)
  ) d
  where pr.user_id = auth.uid()
    and c.cliente_id is distinct from pr.user_id
    and c.status in ('aberto','em_negociacao')
    and not (c.categoria = any(coalesce(pr.especialidades,array[]::text[])))
    and d.ocupadas < public.qf_limite_orcamentos(c.id)
    and not exists (
      select 1 from public.qf_orcamentos o
      where o.chamado_id=c.id and o.status='aceito'
    )
    and not exists (
      select 1 from public.qf_desbloqueios dx
      where dx.chamado_id=c.id and dx.profissional_id=pr.user_id
    )
    and private.qf_pendencia_finalizacao(pr.user_id,'profissional') is null
  order by c.criado_em desc
  limit 80
$function$
;
revoke all on function public.qf_outros_pedidos_vitrine_v2() from public, anon;
grant execute on function public.qf_outros_pedidos_vitrine_v2() to authenticated, service_role;
