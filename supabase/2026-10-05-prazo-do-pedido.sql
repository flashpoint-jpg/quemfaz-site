-- QuemFaz V11.29 — "Pra quando você precisa?" no pedido rápido do cliente.
--
-- O cliente escolhe Hoje / Amanhã / Esta semana / Escolher data / Sem pressa (e, se quiser, o período).
-- O banco guarda o DIA de verdade (prazo_dia), não a palavra "hoje": um pedido feito ontem para "hoje"
-- aparece hoje como atrasado, e não como "hoje" de novo.
--
-- Estas colunas são só informação para o profissional. NÃO mexem em data_preferida, então o aviso
-- continua saindo NA HORA para todo pedido (cascata, push e chamado parado seguem como estavam).

alter table public.qf_chamados
  add column if not exists prazo text,
  add column if not exists prazo_dia date,
  add column if not exists periodo text;

comment on column public.qf_chamados.prazo is
  'Quando o cliente precisa: hoje, amanha, semana, data, sem_pressa. Nulo = pedido antigo (não perguntava).';
comment on column public.qf_chamados.prazo_dia is
  'Dia real do prazo (para "semana" é o último dia). Nulo em sem_pressa e em pedidos antigos.';
comment on column public.qf_chamados.periodo is
  'Melhor horário, opcional: manha, tarde, noite.';

-- Arruma o prazo antes de gravar. Nunca recusa o pedido: se vier algo estranho, grava sem prazo.
create or replace function private.qf_chamado_normalizar_prazo()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_conferir_dia boolean := (tg_op = 'INSERT');
begin
  new.prazo := nullif(lower(btrim(coalesce(new.prazo, ''))), '');
  new.periodo := nullif(lower(btrim(coalesce(new.periodo, ''))), '');

  if new.prazo is null or new.prazo not in ('hoje', 'amanha', 'semana', 'data', 'sem_pressa') then
    new.prazo := null; new.prazo_dia := null; new.periodo := null;
    return new;
  end if;

  if new.prazo = 'sem_pressa' then
    new.prazo_dia := null; new.periodo := null;
    return new;
  end if;

  if new.periodo is not null and new.periodo not in ('manha', 'tarde', 'noite') then
    new.periodo := null;
  end if;

  -- Só confere o dia quando o pedido nasce ou quando o dia muda (não mexe em pedido antigo ao editar).
  if not v_conferir_dia then
    v_conferir_dia := new.prazo_dia is distinct from old.prazo_dia or new.prazo is distinct from old.prazo;
  end if;
  if v_conferir_dia then
    if new.prazo_dia is null or new.prazo_dia < v_hoje - 1 or new.prazo_dia > v_hoje + 370 then
      new.prazo_dia := case new.prazo
        when 'hoje' then v_hoje
        when 'amanha' then v_hoje + 1
        when 'semana' then v_hoje + 6
        else null
      end;
    end if;
    if new.prazo_dia is null then
      new.prazo := null; new.periodo := null;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'QuemFaz normalizar prazo: %', sqlerrm;
  new.prazo := null; new.prazo_dia := null; new.periodo := null;
  return new;
end;
$function$;

drop trigger if exists qf_chamado_normalizar_prazo_before_write on public.qf_chamados;
create trigger qf_chamado_normalizar_prazo_before_write
  before insert or update of prazo, prazo_dia, periodo on public.qf_chamados
  for each row execute function private.qf_chamado_normalizar_prazo();

-- Texto curto do prazo, usado na notificação. Calculado na hora do envio, pelo dia de São Paulo.
create or replace function private.qf_prazo_texto(p_prazo text, p_dia date, p_periodo text)
returns text
language sql
stable
set search_path to ''
as $function$
  with base as (
    select
      (now() at time zone 'America/Sao_Paulo')::date as hoje,
      (array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])[extract(dow from p_dia)::int + 1] as dia_semana,
      to_char(p_dia, 'DD/MM') as dm,
      case p_periodo
        when 'manha' then ' (de manhã)'
        when 'tarde' then ' (à tarde)'
        when 'noite' then ' (à noite)'
        else ''
      end as periodo
  )
  select case
    when p_prazo is null then null
    when p_prazo = 'sem_pressa' then 'SEM PRESSA'
    when p_dia is null then null
    when p_prazo = 'semana' and p_dia < b.hoje then 'ERA ATÉ ' || b.dm
    when p_prazo = 'semana' and p_dia = b.hoje then 'ATÉ HOJE'
    when p_prazo = 'semana' and p_dia = b.hoje + 1 then 'ATÉ AMANHÃ'
    when p_prazo = 'semana' then 'ATÉ ' || upper(b.dia_semana) || ' ' || b.dm
    when p_dia < b.hoje then 'ERA PRA ' || b.dm
    when p_dia = b.hoje then 'PRA HOJE' || b.periodo
    when p_dia = b.hoje + 1 then 'PRA AMANHÃ' || b.periodo
    else 'PRA ' || upper(b.dia_semana) || ' ' || b.dm || b.periodo
  end
  from base b;
$function$;

revoke all on function private.qf_prazo_texto(text, date, text) from public, anon, authenticated;

-- Prazo dos pedidos que o app já carregou (cliente: os dele; profissional: os que ele enxerga).
-- Função nova e separada de propósito: as funções que listam pedidos continuam exatamente como estavam.
create or replace function public.qf_chamados_prazos(p_ids uuid[])
returns table(id uuid, prazo text, prazo_dia date, periodo text)
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id, c.prazo, c.prazo_dia, c.periodo
  from public.qf_chamados c
  where c.id = any((coalesce(p_ids, array[]::uuid[]))[1:500])
    and c.prazo is not null
    and (
      c.cliente_id = auth.uid()
      or exists (select 1 from public.qf_profissionais pr where pr.user_id = auth.uid())
    );
$function$;

revoke all on function public.qf_chamados_prazos(uuid[]) from public, anon;
grant execute on function public.qf_chamados_prazos(uuid[]) to authenticated;

-- Notificação de chamado novo: o prazo vai na frente do que o cliente escreveu.
-- A função quemfaz-push não muda; ela já mostra esta descrição entre aspas.
create or replace function public.qf_push_detalhes_chamado(p_chamado_id uuid, p_user_ids uuid[])
 returns table(user_id uuid, distancia_km numeric, tempo_min integer, preco_centavos integer, plano_restantes integer, descricao text, fotos integer, videos integer)
 language sql
 stable security definer
 set search_path to ''
as $function$
  with c as (
    select ch.id,
           g.latitude,
           g.longitude,
           nullif(concat_ws(': ',
             private.qf_prazo_texto(ch.prazo, ch.prazo_dia, ch.periodo),
             nullif(btrim(public.qf_ocultar_contato(ch.descricao)), '')
           ), '') as descricao,
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
         c.descricao,
         c.fotos,
         c.videos
  from c
  join public.qf_profissionais pr on pr.user_id = any(coalesce(p_user_ids, array[]::uuid[]));
$function$;

-- Pedido com data marcada não vence antes do dia: só expira 3 dias depois do prazo.
-- (Única mudança: a linha do prazo_dia. Pedidos sem prazo seguem a regra de sempre.)
create or replace function private.qf_expirar_chamados()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_n integer;
begin
  with alvo as (
    select c.id
    from public.qf_chamados c
    where c.status = 'aberto'
      and c.criado_em < now() - interval '3 days'
      and c.atualizado_em < now() - interval '3 days'
      and (c.data_preferida is null or c.data_preferida < now() - interval '3 days')
      and (c.prazo_dia is null or c.prazo_dia < (now() at time zone 'America/Sao_Paulo')::date - 3)
      and not (
        coalesce(c.prioridade, false)
        and c.prioridade_ate is not null
        and c.prioridade_ate > now()
      )
      and not exists (
        select 1 from public.qf_orcamentos o
        where o.chamado_id = c.id
          and greatest(o.criado_em, o.atualizado_em) > now() - interval '3 days'
      )
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and d.criado_em > now() - interval '3 days'
      )
    for update skip locked
  )
  update public.qf_chamados c
     set status = 'expirado', atualizado_em = now()
    from alvo
   where c.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- Fechamento automático em 7 dias: com data marcada, conta 7 dias depois do prazo.
create or replace function private.qf_fechar_sem_retorno()
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_n integer;
begin
  with alvo as (
    select c.id
    from public.qf_chamados c
    where c.status in ('em_negociacao', 'confirmado', 'em_andamento')
      -- serviço agendado para frente só conta 7 dias depois da data marcada
      and (c.data_preferida is null or c.data_preferida < now() - interval '7 days')
      and (c.prazo_dia is null or c.prazo_dia < (now() at time zone 'America/Sao_Paulo')::date - 7)
      and exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and coalesce(d.ativo, true)
      )
      and not exists (
        select 1 from public.qf_desbloqueios d
        where d.chamado_id = c.id and coalesce(d.ativo, true)
          and d.criado_em > now() - interval '7 days'
      )
    for update skip locked
  )
  update public.qf_chamados c
     set status = 'cancelado', desfecho = case when exists (
           select 1 from public.qf_desbloqueios dp
           where dp.chamado_id = c.id and coalesce(dp.ativo, true) and dp.desfecho is null
         ) then 'sem_retorno' else 'nao_fechado' end, desfecho_em = now(), atualizado_em = now()
    from alvo
   where c.id = alvo.id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
