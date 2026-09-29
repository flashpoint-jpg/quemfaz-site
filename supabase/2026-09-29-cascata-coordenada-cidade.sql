-- QuemFaz — suporte de coordenada da cidade para cascata e distância
-- Permite expandir chamados mesmo quando o cliente escolhe apenas cidade/UF,
-- sem exigir GPS ou endereço completo.

create or replace function private.qf_chamado_centro(p_chamado_id uuid)
returns table(latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path to ''
as $$
  with c as (
    select ch.id, ch.cliente_id, ch.cidade, ch.uf, ch.latitude, ch.longitude
    from public.qf_chamados ch
    where ch.id = p_chamado_id
  ),
  endereco_cliente as (
    select e.latitude, e.longitude
    from c
    join public.qf_enderecos e on e.user_id = c.cliente_id
    where private.qf_norm_txt(e.cidade) = private.qf_norm_txt(c.cidade)
      and upper(trim(e.uf::text)) = upper(trim(coalesce(c.uf::text, '')))
      and e.latitude is not null and e.longitude is not null
    limit 1
  ),
  referencia_cidade as (
    select avg(z.latitude)::numeric as latitude, avg(z.longitude)::numeric as longitude
    from c
    cross join lateral (
      select pc.latitude, pc.longitude
      from public.qf_profissional_cidades pc
      where private.qf_norm_txt(pc.cidade) = private.qf_norm_txt(c.cidade)
        and upper(trim(pc.uf::text)) = upper(trim(coalesce(c.uf::text, '')))
        and pc.latitude is not null and pc.longitude is not null
      union all
      select e.latitude, e.longitude
      from public.qf_enderecos e
      where private.qf_norm_txt(e.cidade) = private.qf_norm_txt(c.cidade)
        and upper(trim(e.uf::text)) = upper(trim(coalesce(c.uf::text, '')))
        and e.latitude is not null and e.longitude is not null
    ) z
  )
  select
    case
      when c.latitude is not null and c.longitude is not null then c.latitude
      when ec.latitude is not null and ec.longitude is not null then ec.latitude
      else rc.latitude
    end,
    case
      when c.latitude is not null and c.longitude is not null then c.longitude
      when ec.latitude is not null and ec.longitude is not null then ec.longitude
      else rc.longitude
    end
  from c
  left join endereco_cliente ec on true
  left join referencia_cidade rc on true;
$$;

revoke all on function private.qf_chamado_centro(uuid) from public, anon, authenticated;

create or replace function public.qf_chamado_destinatarios_alcance(
  p_chamado_id uuid,
  p_raio_km integer default 0
)
returns table(user_id uuid, online boolean, distancia_regiao_km numeric)
language sql
stable
security definer
set search_path to ''
as $$
  with c as (
    select ch.id, ch.cliente_id, ch.categoria, ch.cidade, ch.uf, ch.status,
           g.latitude as centro_lat, g.longitude as centro_lng
    from public.qf_chamados ch
    left join lateral private.qf_chamado_centro(ch.id) g on true
    where ch.id = p_chamado_id
  ),
  candidatos as (
    select
      pr.user_id,
      pr.online,
      private.qf_pro_atende_cidade(pr.user_id, c.cidade, c.uf::text) as cidade_exata,
      case
        when c.centro_lat is not null and c.centro_lng is not null
             and pr.latitude is not null and pr.longitude is not null
          then public.qf_distancia_km(pr.latitude, pr.longitude, c.centro_lat, c.centro_lng)
        else (
          select min(public.qf_distancia_km(pc.latitude, pc.longitude, c.centro_lat, c.centro_lng))
          from public.qf_profissional_cidades pc
          where pc.profissional_id = pr.user_id
            and pc.latitude is not null and pc.longitude is not null
            and c.centro_lat is not null and c.centro_lng is not null
        )
      end as distancia_calc,
      exists (
        select 1
        from public.qf_profissional_cidades pc
        where pc.profissional_id = pr.user_id
          and pc.latitude is not null and pc.longitude is not null
          and c.centro_lat is not null and c.centro_lng is not null
          and public.qf_distancia_km(pc.latitude, pc.longitude, c.centro_lat, c.centro_lng)
              <= greatest(1, coalesce(p_raio_km, 0))
      ) as cidade_proxima
    from c
    join public.qf_profissionais pr on true
    join public.qf_profiles pf on pf.id = pr.user_id
    where c.status = 'aberto'
      and coalesce(pf.ativo, true)
      and pr.user_id <> c.cliente_id
      and c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and d.profissional_id = pr.user_id
      )
  )
  select x.user_id, x.online,
         case when x.distancia_calc is null then null else round(x.distancia_calc, 1) end
  from candidatos x
  where x.cidade_exata
     or (
       coalesce(p_raio_km, 0) > 0
       and (x.cidade_proxima or x.distancia_calc <= greatest(1, coalesce(p_raio_km, 0)))
     )
  order by x.cidade_exata desc, x.distancia_calc asc nulls last;
$$;

revoke all on function public.qf_chamado_destinatarios_alcance(uuid,integer) from public, anon, authenticated;
grant execute on function public.qf_chamado_destinatarios_alcance(uuid,integer) to service_role;

create or replace function public.qf_push_detalhes_chamado(p_chamado_id uuid, p_user_ids uuid[])
returns table(user_id uuid, distancia_km numeric, tempo_min integer, preco_centavos integer,
              plano_restantes integer, descricao text, fotos integer, videos integer)
language sql
stable security definer
set search_path to ''
as $$
  with c as (
    select ch.id, g.latitude, g.longitude,
           public.qf_ocultar_contato(ch.descricao) as descricao,
           coalesce(pd.preco_centavos, padrao.preco_centavos, 790)::integer as preco,
           (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(ch.fotos) = 'array' then ch.fotos else '[]'::jsonb end) f
             where f not ilike 'data:video/%')::integer as fotos,
           (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(ch.fotos) = 'array' then ch.fotos else '[]'::jsonb end) f
             where f ilike 'data:video/%')::integer as videos
    from public.qf_chamados ch
    left join lateral private.qf_chamado_centro(ch.id) g on true
    left join public.qf_precos_desbloqueio pd on pd.categoria = ch.categoria and pd.ativo
    left join public.qf_precos_desbloqueio padrao on padrao.categoria = 'padrao'
    where ch.id = p_chamado_id
  )
  select pr.user_id,
         round(public.qf_distancia_km(pr.latitude, pr.longitude, c.latitude, c.longitude), 1),
         public.qf_tempo_estimado_min(public.qf_distancia_km(pr.latitude, pr.longitude, c.latitude, c.longitude)),
         c.preco,
         coalesce((select sum(pl.chamados_restantes) from public.qf_planos_profissional pl
                    where pl.profissional_id = pr.user_id and pl.valido_ate > now() and pl.chamados_restantes > 0), 0)::integer,
         c.descricao, c.fotos, c.videos
  from c
  join public.qf_profissionais pr on pr.user_id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;

revoke all on function public.qf_push_detalhes_chamado(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.qf_push_detalhes_chamado(uuid,uuid[]) to service_role;
