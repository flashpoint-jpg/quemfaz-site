-- QuemFaz — chamados por cidade escolhida pelo cliente
-- Regra: chamado só vai para profissional ativo da mesma cidade/UF e da categoria.
-- A distância continua sendo calculada individualmente apenas para informação.

create or replace function private.qf_pro_atende_cidade(
  p_pro uuid, p_cidade text, p_uf text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select
    exists (
      select 1
      from public.qf_profissional_cidades pc
      where pc.profissional_id = p_pro
        and private.qf_norm_txt(pc.cidade) = private.qf_norm_txt(p_cidade)
        and upper(trim(pc.uf::text)) = upper(trim(coalesce(p_uf, '')))
    )
    or exists (
      select 1
      from public.qf_profiles pf
      where pf.id = p_pro
        and private.qf_norm_txt(pf.cidade) = private.qf_norm_txt(p_cidade)
        and upper(trim(pf.uf::text)) = upper(trim(coalesce(p_uf, '')))
    );
$$;

revoke all on function private.qf_pro_atende_cidade(uuid,text,text) from public, anon, authenticated;

create or replace function public.qf_cascata_destinatarios(p_chamado_id uuid)
returns table (user_id uuid, online boolean)
language sql
stable
security definer
set search_path to ''
as $$
  select pr.user_id, pr.online
  from public.qf_chamados c
  join public.qf_profissionais pr on true
  join public.qf_profiles pf on pf.id = pr.user_id
  where c.id = p_chamado_id
    and c.status = 'aberto'
    and coalesce(pf.ativo, true)
    and pr.user_id <> c.cliente_id
    and (cardinality(pr.especialidades) = 0 or c.categoria = any(pr.especialidades))
    and not exists (
      select 1 from public.qf_desbloqueios d
      where d.chamado_id = c.id and d.profissional_id = pr.user_id
    )
    and private.qf_pro_atende_cidade(pr.user_id, c.cidade, c.uf::text);
$$;

revoke all on function public.qf_cascata_destinatarios(uuid) from public, anon, authenticated;
grant execute on function public.qf_cascata_destinatarios(uuid) to service_role;

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
    and private.qf_pro_atende_cidade(p.user_id, c.cidade, c.uf::text)
    and (
      p.online = true
      or exists (
        select 1 from public.qf_push_entregas e
        where e.chamado_id = c.id and e.user_id = p.user_id and e.evento = 'new_call'
      )
      or exists (
        select 1 from public.qf_chamado_cascata k
        where k.chamado_id = c.id and k.etapa >= 2
      )
    )
    and (
      cardinality(p.especialidades) = 0
      or c.categoria = any(p.especialidades)
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
