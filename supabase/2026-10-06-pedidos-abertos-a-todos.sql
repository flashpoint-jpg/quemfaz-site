-- QuemFaz 11.32.0 — pedidos "Abertos a todos"
--
-- Regra aprovada:
--   * o pedido passa pelas etapas da cascata (online primeiro, depois offline); se ninguém da
--     categoria desbloquear, ele é liberado na hora para TODOS os profissionais do app;
--   * quando não existe profissional da categoria que atenda a cidade do pedido, libera direto;
--   * vale para qualquer profissional, de qualquer região, sempre com a distância até o pedido;
--   * não toca o alerta de chamado: o pedido só aparece na lista (nenhum push novo é enviado);
--   * o pedido sai de "abertos a todos" assim que alguém desbloqueia.
--
-- Nada muda para o pedido normal: quem é da categoria e da região continua recebendo como antes.

-- 1) Centro aproximado de uma cidade (para quem não tem localização salva).
create or replace function private.qf_cidade_centro(p_cidade text, p_uf text)
returns table(latitude numeric, longitude numeric)
language sql
stable security definer
set search_path to ''
as $$
  select avg(z.latitude)::numeric, avg(z.longitude)::numeric
  from (
    select pc.latitude, pc.longitude
    from public.qf_profissional_cidades pc
    where private.qf_norm_txt(pc.cidade) = private.qf_norm_txt(p_cidade)
      and upper(trim(pc.uf::text)) = upper(trim(coalesce(p_uf, '')))
      and pc.latitude is not null and pc.longitude is not null
    union all
    select e.latitude, e.longitude
    from public.qf_enderecos e
    where private.qf_norm_txt(e.cidade) = private.qf_norm_txt(p_cidade)
      and upper(trim(e.uf::text)) = upper(trim(coalesce(p_uf, '')))
      and e.latitude is not null and e.longitude is not null
    union all
    select c.latitude, c.longitude
    from public.qf_chamados c
    where private.qf_norm_txt(c.cidade) = private.qf_norm_txt(p_cidade)
      and upper(trim(c.uf::text)) = upper(trim(coalesce(p_uf, '')))
      and c.latitude is not null and c.longitude is not null
    union all
    select pr.latitude, pr.longitude
    from public.qf_profissionais pr
    join public.qf_profiles pf on pf.id = pr.user_id
    where private.qf_norm_txt(pf.cidade) = private.qf_norm_txt(p_cidade)
      and upper(trim(pf.uf::text)) = upper(trim(coalesce(p_uf, '')))
      and pr.latitude is not null and pr.longitude is not null
  ) z;
$$;

-- 2) Regra normal: o profissional é da categoria e atende a cidade (ou já foi avisado do pedido).
create or replace function private.qf_pro_recebe_chamado(p_pro uuid, p_chamado_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.qf_chamados c
    join public.qf_profissionais pr on pr.user_id = p_pro
    where c.id = p_chamado_id
      and c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
      and (
        private.qf_pro_atende_cidade(p_pro, c.cidade, c.uf::text)
        or exists (
          select 1
          from public.qf_push_entregas e
          where e.chamado_id = c.id
            and e.user_id = p_pro
            and e.evento = 'new_call'
        )
      )
  );
$$;

-- 3) O pedido está aberto a todos? Devolve o motivo, ou null quando não está.
create or replace function private.qf_chamado_aberto_todos(p_chamado_id uuid)
returns text
language sql
stable security definer
set search_path to ''
as $$
  select case
    when c.status not in ('aberto','em_negociacao') then null
    when exists (
      select 1 from public.qf_desbloqueios d
      where d.chamado_id = c.id and coalesce(d.ativo, true)
    ) then null
    when not exists (
      select 1
      from public.qf_profissionais pr
      join public.qf_profiles pf on pf.id = pr.user_id
      where coalesce(pf.ativo, true)
        and pr.user_id is distinct from c.cliente_id
        and c.categoria = any(coalesce(pr.especialidades, array[]::text[]))
        and private.qf_pro_atende_cidade(pr.user_id, c.cidade, c.uf::text)
    ) then 'sem_profissional'
    when exists (
      select 1 from public.qf_chamado_cascata k
      where k.chamado_id = c.id and k.etapa >= 3
    ) then 'sem_desbloqueio'
    else null
  end
  from public.qf_chamados c
  where c.id = p_chamado_id;
$$;

-- 4) A lista do profissional passa a incluir os pedidos abertos a todos.
--    (Mesma função, mesmas colunas: só a condição de quem enxerga o pedido muda.)
do $do$
declare
  def text := pg_get_functiondef('public.qf_listar_chamados_disponiveis()'::regprocedure);
  s1 text;
  s2 text;
begin
  if position('qf_chamado_aberto_todos' in def) > 0 then return; end if;
  s1 := regexp_replace(def, 'and c\.categoria = any\(coalesce\(p\.especialidades,array\[\]::text\[\]\)\)\s+', '');
  if s1 = def then raise exception 'qf_listar_chamados_disponiveis: filtro de categoria não encontrado'; end if;
  s2 := regexp_replace(s1,
    'private\.qf_pro_atende_cidade\(p\.user_id,c\.cidade,c\.uf::text\)\s+or exists \(\s+select 1\s+from public\.qf_push_entregas e\s+where e\.chamado_id = c\.id\s+and e\.user_id = p\.user_id\s+and e\.evento = ''new_call''\s+\)',
    'private.qf_pro_recebe_chamado(p.user_id,c.id)
      or (c.cliente_id is distinct from p.user_id and private.qf_chamado_aberto_todos(c.id) is not null)');
  if s2 = s1 then raise exception 'qf_listar_chamados_disponiveis: filtro de região não encontrado'; end if;
  execute s2;
end
$do$;

-- 5) Para o app: quais pedidos da lista deste profissional estão "abertos a todos", o motivo e a distância.
--    Sem localização salva, a distância vem aproximada (centro da cidade do profissional);
--    na mesma cidade do pedido, fica sem número e o app mostra "na sua cidade".
create or replace function public.qf_pedidos_abertos_todos()
returns table(id uuid, motivo text, distancia_km numeric, aproximada boolean, mesma_cidade boolean)
language sql
stable security definer
set search_path to ''
as $$
  with eu as (
    select pr.user_id, pr.latitude, pr.longitude, pf.cidade, pf.uf::text as uf
    from public.qf_profissionais pr
    join public.qf_profiles pf on pf.id = pr.user_id
    where pr.user_id = auth.uid()
  ),
  ref as (
    select eu.user_id, eu.cidade, eu.uf, cc.latitude as c_lat, cc.longitude as c_lng
    from eu
    left join lateral private.qf_cidade_centro(eu.cidade, eu.uf) cc
      on (eu.latitude is null or eu.longitude is null)
  )
  select
    d.id,
    private.qf_chamado_aberto_todos(d.id) as motivo,
    case
      when d.distancia_km is not null then d.distancia_km
      when private.qf_norm_txt(ch.cidade) = private.qf_norm_txt(r.cidade)
       and upper(trim(ch.uf::text)) = upper(trim(coalesce(r.uf, ''))) then null
      else round(public.qf_distancia_km(r.c_lat, r.c_lng, g.latitude, g.longitude), 0)
    end as distancia_km,
    (d.distancia_km is null) as aproximada,
    (private.qf_norm_txt(ch.cidade) = private.qf_norm_txt(r.cidade)
      and upper(trim(ch.uf::text)) = upper(trim(coalesce(r.uf, '')))) as mesma_cidade
  from public.qf_listar_chamados_disponiveis() d
  join public.qf_chamados ch on ch.id = d.id
  cross join ref r
  left join lateral private.qf_chamado_centro(d.id) g on true
  where not private.qf_pro_recebe_chamado(r.user_id, d.id);
$$;

-- 6) Faixa de movimento no topo da tela do profissional.
create or replace function public.qf_movimento_pedidos()
returns jsonb
language sql
stable security definer
set search_path to ''
as $$
  select case
    when exists (select 1 from public.qf_profissionais pr where pr.user_id = auth.uid()) then
      jsonb_build_object(
        'ok', true,
        'hoje', count(*) filter (
          where (c.criado_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
        ),
        'semana', count(*),
        'sem_profissional', count(*) filter (
          where c.status in ('aberto','em_negociacao')
            and not exists (
              select 1 from public.qf_desbloqueios d
              where d.chamado_id = c.id and coalesce(d.ativo, true)
            )
        )
      )
    else jsonb_build_object('ok', false)
  end
  from public.qf_chamados c
  where c.status <> 'cancelado'
    and c.criado_em >= now() - interval '7 days';
$$;

revoke all on function private.qf_cidade_centro(text, text) from public, anon, authenticated;
revoke all on function private.qf_pro_recebe_chamado(uuid, uuid) from public, anon, authenticated;
revoke all on function private.qf_chamado_aberto_todos(uuid) from public, anon, authenticated;
revoke all on function public.qf_pedidos_abertos_todos() from public, anon;
revoke all on function public.qf_movimento_pedidos() from public, anon;
grant execute on function public.qf_pedidos_abertos_todos() to authenticated;
grant execute on function public.qf_movimento_pedidos() to authenticated;
