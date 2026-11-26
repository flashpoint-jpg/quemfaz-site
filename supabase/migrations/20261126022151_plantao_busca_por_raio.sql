-- Estimativa em linha reta até a região do atendimento, sem expor coordenadas.
create function private.qf_plantao_alcance(p_profissional uuid, p_cidade text, p_uf text)
returns table(distancia_km numeric, dentro_raio boolean)
language sql stable set search_path = '' as $$
  select min(calculo.km), coalesce(bool_or(calculo.km <= base.raio_km), false)
  from public.qf_profissionais pr
  cross join private.qf_cidade_centro(p_cidade, p_uf) destino
  cross join lateral (
    select pr.latitude, pr.longitude, pr.raio_km
    union all
    select pc.latitude, pc.longitude, coalesce(pc.raio_km, pr.raio_km)
    from public.qf_profissional_cidades pc
    where pc.profissional_id = pr.user_id
  ) base
  cross join lateral (
    select public.qf_distancia_km(base.latitude, base.longitude, destino.latitude, destino.longitude) as km
  ) calculo
  where pr.user_id = p_profissional;
$$;

revoke all on function private.qf_plantao_alcance(uuid,text,text) from public, anon, authenticated;

-- Esta regra é compartilhada pela busca, pela notificação e pelo aceite.
create or replace function private.qf_plantao_elegivel(p_profissional uuid,p_categoria text,p_cidade text,p_uf text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_categoria = any(private.qf_plantao_categorias())
    and exists (
      select 1
      from private.qf_plantao_profissionais d
      join public.qf_profissionais pr on pr.user_id = d.profissional_id
      join public.qf_profiles p on p.id = pr.user_id
      where d.profissional_id = p_profissional and d.disponivel
        and (d.inscrito_gratis or private.qf_plantao_plano_ativo(d.profissional_id))
        and p.ativo and p.tipo = 'profissional'
        and p_categoria = any(pr.especialidades)
        and case
          when upper(p.uf) = p_uf and lower(btrim(p.cidade)) = lower(btrim(p_cidade)) then true
          when exists (
            select 1 from public.qf_profissional_cidades a
            where a.profissional_id = pr.user_id
              and upper(a.uf) = p_uf and lower(btrim(a.cidade)) = lower(btrim(p_cidade))
          ) then true
          else (select dentro_raio from private.qf_plantao_alcance(p_profissional, p_cidade, p_uf))
        end
    );
$$;

CREATE OR REPLACE FUNCTION public.qf_plantao_listar()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(info order by criado_em desc),'[]'::jsonb)
 from (
   select c.criado_em, jsonb_build_object(
    'id',c.id,'categoria',c.categoria,'cidade',c.cidade,'uf',c.uf,'bairro',c.bairro,
    'estado',case when c.sem_profissional_em is not null then 'sem_profissional'
                 when c.estado='buscando' and c.prazo_busca<=now() then 'sem_atendimento'
                 when c.estado='oferta' and c.prazo_oferta<=now() then 'sem_atendimento' else c.estado end,
    'cliente',c.cliente_id=auth.uid(),'meu_aceite',coalesce(c.profissional_id=auth.uid(),false),
    'descricao',case when auth.uid() in (c.cliente_id,c.profissional_id) or c.estado='buscando' then c.descricao end,
    'chegada_minutos',c.chegada_minutos,'profissional_nome',case when c.cliente_id=auth.uid() then case when private.qf_plantao_texto_seguro(pro.nome) then split_part(pro.nome,' ',1) else 'Profissional de plantão' end end,
    'telefone',case when c.estado='confirmado' then case when auth.uid()=c.cliente_id then coalesce(nullif(pro.whatsapp,''),pro.telefone) else coalesce(nullif(cli.whatsapp,''),cli.telefone) end end,
    'endereco',case when c.estado='confirmado' and c.profissional_id=auth.uid() then c.endereco end,
    'prazo_pix',c.prazo_pix,
    'distancia_km',case
      when c.cliente_id <> auth.uid() and c.estado='buscando' and c.prazo_busca>now()
      then (select round(distancia_km) from private.qf_plantao_alcance(auth.uid(),c.cidade,c.uf))
    end,
    'profissionais_disponiveis',case
      when c.cliente_id=auth.uid() and c.estado='buscando' and c.prazo_busca>now()
      then cardinality(public.qf_plantao_push_destinatarios(c.id))
    end
   ) as info
   from private.qf_plantao_chamados c
   join public.qf_profiles cli on cli.id=c.cliente_id
   left join public.qf_profiles pro on pro.id=c.profissional_id
   where auth.uid() is not null and (
     c.cliente_id=auth.uid() or c.profissional_id=auth.uid() or
     (c.estado='buscando' and c.prazo_busca>now() and private.qf_plantao_elegivel(auth.uid(),c.categoria,c.cidade,c.uf))
   )
   order by c.criado_em desc limit 30
 ) t;
$function$;
