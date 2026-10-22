-- QuemFaz — cascata geográfica por cidade e proximidade
-- 1) Primeiro somente a cidade/UF escolhida pelo cliente.
-- 2) Sem aceite, amplia gradualmente por distância.
-- 3) A categoria deve coincidir exatamente com uma especialidade do profissional.
-- 4) A distância mostrada ao profissional continua sendo calculada a partir da posição dele.

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
    select id, cliente_id, categoria, cidade, uf, latitude, longitude, status
    from public.qf_chamados
    where id = p_chamado_id
  ),
  candidatos as (
    select
      pr.user_id,
      pr.online,
      private.qf_pro_atende_cidade(pr.user_id, c.cidade, c.uf::text) as cidade_exata,
      case
        when c.latitude is not null and c.longitude is not null
             and pr.latitude is not null and pr.longitude is not null
          then public.qf_distancia_km(pr.latitude, pr.longitude, c.latitude, c.longitude)
        else (
          select min(public.qf_distancia_km(pc.latitude, pc.longitude, c.latitude, c.longitude))
          from public.qf_profissional_cidades pc
          where pc.profissional_id = pr.user_id
            and pc.latitude is not null and pc.longitude is not null
            and c.latitude is not null and c.longitude is not null
        )
      end as distancia_calc,
      exists (
        select 1
        from public.qf_profissional_cidades pc
        where pc.profissional_id = pr.user_id
          and pc.latitude is not null and pc.longitude is not null
          and c.latitude is not null and c.longitude is not null
          and public.qf_distancia_km(pc.latitude, pc.longitude, c.latitude, c.longitude)
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
        select 1
        from public.qf_desbloqueios d
        where d.chamado_id = c.id and d.profissional_id = pr.user_id
      )
  )
  select
    x.user_id,
    x.online,
    case when x.distancia_calc is null then null else round(x.distancia_calc, 1) end
  from candidatos x
  where
    x.cidade_exata
    or (
      coalesce(p_raio_km, 0) > 0
      and (
        x.cidade_proxima
        or x.distancia_calc <= greatest(1, coalesce(p_raio_km, 0))
      )
    )
  order by x.cidade_exata desc, x.distancia_calc asc nulls last;
$$;

revoke all on function public.qf_chamado_destinatarios_alcance(uuid,integer) from public, anon, authenticated;
grant execute on function public.qf_chamado_destinatarios_alcance(uuid,integer) to service_role;

create or replace function public.qf_listar_chamados_disponiveis()
returns table(
  id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text,
  endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone,
  prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric,
  raio_atual_km integer, preco_centavos integer, tempo_min integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with profissional as (
    select
      pr.user_id,
      pr.especialidades,
      pr.online,
      pr.latitude as pro_latitude,
      pr.longitude as pro_longitude,
      greatest(
        1,
        coalesce(
          (select max(pc.raio_km)
             from public.qf_profissional_cidades pc
            where pc.profissional_id = pr.user_id),
          pr.raio_km,
          20
        )
      )::integer as raio_configurado_km
    from public.qf_profissionais pr
    where pr.user_id = auth.uid()
      and exists (
        select 1 from public.qf_profiles pf
        where pf.id = pr.user_id and coalesce(pf.ativo, true)
      )
  )
  select
    c.id,
    c.categoria,
    c.titulo,
    public.qf_ocultar_contato(c.descricao) as descricao,
    c.cidade,
    c.uf,
    c.bairro,
    null::text as endereco_completo,
    round(c.latitude, 2) as latitude,
    round(c.longitude, 2) as longitude,
    c.data_preferida,
    c.prioridade,
    c.criado_em,
    c.status,
    case
      when public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude) is null then null
      else round(public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude), 1)
    end as distancia_km,
    p.raio_configurado_km as raio_atual_km,
    coalesce(pd.preco_centavos, padrao.preco_centavos, 790)::integer as preco_centavos,
    public.qf_tempo_estimado_min(public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude)) as tempo_min
  from public.qf_chamados c
  cross join profissional p
  left join public.qf_precos_desbloqueio pd on pd.categoria = c.categoria and pd.ativo
  left join public.qf_precos_desbloqueio padrao on padrao.categoria = 'padrao'
  where c.status = 'aberto'
    and c.categoria = any(coalesce(p.especialidades, array[]::text[]))
    and (
      private.qf_pro_atende_cidade(p.user_id, c.cidade, c.uf::text)
      or exists (
        select 1
        from public.qf_push_entregas e
        where e.chamado_id = c.id
          and e.user_id = p.user_id
          and e.evento = 'new_call'
      )
    )
    and not exists (
      select 1
      from public.qf_desbloqueios d
      where d.chamado_id = c.id
        and d.profissional_id = p.user_id
    )
  order by c.prioridade desc,
           public.qf_distancia_km(p.pro_latitude, p.pro_longitude, c.latitude, c.longitude) asc nulls last,
           c.criado_em desc;
$function$;

revoke all on function public.qf_listar_chamados_disponiveis() from public, anon, service_role;
grant execute on function public.qf_listar_chamados_disponiveis() to authenticated;
