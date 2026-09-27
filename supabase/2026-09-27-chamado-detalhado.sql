-- QuemFaz 11.13.0 — chamado detalhado antes do desbloqueio
-- O profissional vê tudo do serviço antes de pagar (descrição, fotos, vídeos, distância,
-- tempo estimado e valor do desbloqueio). Só o CONTATO do cliente continua escondido:
--   * telefone, e-mail, @perfil e links de WhatsApp/Instagram escritos na descrição viram "[contato oculto]";
--   * o endereço exato (rua/número) e as coordenadas exatas não saem mais do banco antes do desbloqueio
--     (antes iam na resposta da API, mesmo sem aparecer na tela).
-- O preço devolvido é o MESMO que qf_desbloquear_chamado cobra (tabela qf_precos_desbloqueio).

-- 1) Esconde contato escrito no texto do cliente.
create or replace function public.qf_ocultar_contato(p_texto text)
returns text
language sql
immutable
parallel safe
set search_path to ''
as $$
  select case when p_texto is null then null else
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(p_texto,
            '(https?://)?(www\.)?(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com|instagram\.com|facebook\.com|fb\.com|t\.me)(/[^[:space:]]*)?',
            '[contato oculto]', 'gi'),
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contato oculto]', 'g'),
        '(^|[^A-Za-z0-9_])@[A-Za-z0-9_.]{3,}', '\1[contato oculto]', 'g'),
      '(^|[^0-9+])(\+?55[ .-]?)?(\(?[0-9]{2}\)?[ .-]?)?(9[ .-]?)?[0-9]{4}[ .-]?[0-9]{4}(?![0-9])', '\1[contato oculto]', 'g')
  end
$$;

-- 2) Tempo estimado até o cliente (carro/moto), a partir da distância em linha reta.
--    Trajeto ≈ 1,3 × linha reta. Até 10 km de trajeto: ~27 km/h (cidade). Depois: ~50 km/h.
create or replace function public.qf_tempo_estimado_min(p_km numeric)
returns integer
language sql
immutable
parallel safe
set search_path to ''
as $$
  select case
    when p_km is null or p_km < 0 then null
    else greatest(3, ceil(
      case when p_km * 1.3 <= 10 then 3 + p_km * 1.3 * 2.2
           else 25 + (p_km * 1.3 - 10) * 1.2 end
    ))::integer
  end
$$;

-- 3) Lista de chamados disponíveis para o profissional (mesmas regras de antes)
--    + preço do desbloqueio e tempo estimado; sem endereço exato; contato oculto na descrição.
drop function if exists public.qf_listar_chamados_disponiveis();
create function public.qf_listar_chamados_disponiveis()
 returns table(id uuid, categoria text, titulo text, descricao text, cidade text, uf character, bairro text,
               endereco_completo text, latitude numeric, longitude numeric, data_preferida timestamp with time zone,
               prioridade boolean, criado_em timestamp with time zone, status text, distancia_km numeric,
               raio_atual_km integer, preco_centavos integer, tempo_min integer)
 language sql
 stable security definer
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
    and (
      p.online = true
      or exists (
        select 1 from public.qf_push_entregas e
        where e.chamado_id = c.id and e.user_id = p.user_id and e.evento = 'new_call'
      )
      or (
        exists (select 1 from public.qf_chamado_cascata k where k.chamado_id = c.id and k.etapa >= 2)
        and private.qf_pro_atende_regiao(p.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)
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

-- 4) Detalhes do chamado para o aviso (push) de cada profissional: distância, tempo, preço,
--    chamados do plano, descrição (com contato oculto) e quantidade de fotos/vídeos.
--    Só o servidor (edge function quemfaz-push, service_role) chama.
create or replace function public.qf_push_detalhes_chamado(p_chamado_id uuid, p_user_ids uuid[])
returns table(user_id uuid, distancia_km numeric, tempo_min integer, preco_centavos integer,
              plano_restantes integer, descricao text, fotos integer, videos integer)
language sql
stable security definer
set search_path to ''
as $$
  with c as (
    select ch.id, ch.latitude, ch.longitude,
           public.qf_ocultar_contato(ch.descricao) as descricao,
           coalesce(pd.preco_centavos, padrao.preco_centavos, 790)::integer as preco,
           (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(ch.fotos) = 'array' then ch.fotos else '[]'::jsonb end) f
             where f not ilike 'data:video/%')::integer as fotos,
           (select count(*) from jsonb_array_elements_text(case when jsonb_typeof(ch.fotos) = 'array' then ch.fotos else '[]'::jsonb end) f
             where f ilike 'data:video/%')::integer as videos
    from public.qf_chamados ch
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
         c.descricao,
         c.fotos,
         c.videos
  from c
  join public.qf_profissionais pr on pr.user_id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;
revoke all on function public.qf_push_detalhes_chamado(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.qf_push_detalhes_chamado(uuid, uuid[]) to service_role;
