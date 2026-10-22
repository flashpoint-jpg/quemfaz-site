-- V11.83: "Você fechou?" — o QuemFaz pergunta ao profissional se ele fechou o serviço.
-- 3 horas depois do desbloqueio vai uma faixa leve (sem tela cheia, sem toque de chamado).
-- Sem resposta (ou "Ainda estou conversando"): pergunta mais uma vez no dia seguinte e para.
-- Ao responder "Fechei", o pedido é encerrado na hora (mesma regra de qf_profissional_fechar_chamado).

alter table public.qf_desbloqueios
  add column if not exists fechou_pergunta1_em timestamptz,
  add column if not exists fechou_pergunta2_em timestamptz,
  add column if not exists fechou_conversando_em timestamptz,
  add column if not exists fechou_token uuid not null default gen_random_uuid();

create index if not exists qf_desbloqueios_fechou_pendentes_idx
  on public.qf_desbloqueios (criado_em)
  where desfecho is null and coalesce(ativo, true);

-- ---------------------------------------------------------------------------
-- Rotina (a cada 5 minutos)
-- ---------------------------------------------------------------------------
create or replace function private.qf_perguntar_fechou()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  r record;
  n integer := 0;
  v_seg text;
  v_agora_sp timestamp := (now() at time zone 'America/Sao_Paulo');
  v_titulo text;
  v_corpo text;
  v_rota text;
begin
  -- Só pergunta em horário comercial (8h às 21h de São Paulo).
  if v_agora_sp::time < time '08:00' or v_agora_sp::time >= time '21:00' then
    return 0;
  end if;

  select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;

  for r in
    with base as (
      select d.id, d.chamado_id, d.profissional_id, d.fechou_token, d.criado_em,
             d.fechou_pergunta1_em, d.fechou_pergunta2_em, d.fechou_conversando_em,
             c.titulo, c.bairro, c.cidade,
             case
               when d.fechou_pergunta1_em is null and d.fechou_conversando_em is null then 1
               else 2
             end as etapa
      from public.qf_desbloqueios d
      join public.qf_chamados c on c.id = d.chamado_id
      left join public.qf_profissionais pr on pr.user_id = d.profissional_id
      where coalesce(d.ativo, true)
        and d.desfecho is null
        and d.fechou_pergunta2_em is null
        and c.status in ('em_negociacao', 'confirmado', 'em_andamento')
        and d.criado_em >= now() - interval '7 days'
        -- dentro do horário de atendimento escolhido pelo profissional (quando escolheu)
        and (
          pr.horario_inicio is null or pr.horario_fim is null or pr.horario_inicio = pr.horario_fim
          or (pr.horario_inicio < pr.horario_fim and v_agora_sp::time >= pr.horario_inicio and v_agora_sp::time < pr.horario_fim)
          or (pr.horario_inicio > pr.horario_fim and (v_agora_sp::time >= pr.horario_inicio or v_agora_sp::time < pr.horario_fim))
        )
        and (
          -- 1ª pergunta: 3 horas depois do desbloqueio
          (d.fechou_pergunta1_em is null and d.fechou_conversando_em is null
             and d.criado_em <= now() - interval '3 hours')
          or
          -- 2ª e última: no dia seguinte à 1ª pergunta (ou ao "Ainda estou conversando")
          ((d.fechou_pergunta1_em is not null or d.fechou_conversando_em is not null)
             and (greatest(d.fechou_pergunta1_em, d.fechou_conversando_em) at time zone 'America/Sao_Paulo')::date < v_agora_sp::date
             and greatest(d.fechou_pergunta1_em, d.fechou_conversando_em) <= now() - interval '10 hours')
        )
        -- no máximo uma pergunta a cada 30 minutos para o mesmo profissional
        and not exists (
          select 1 from public.qf_desbloqueios x
          where x.profissional_id = d.profissional_id
            and greatest(x.fechou_pergunta1_em, x.fechou_pergunta2_em) > now() - interval '30 minutes'
        )
    )
    select distinct on (profissional_id) *
    from base
    order by profissional_id, criado_em asc
    limit 100
  loop
    if r.etapa = 1 then
      update public.qf_desbloqueios set fechou_pergunta1_em = now() where id = r.id;
    else
      update public.qf_desbloqueios set fechou_pergunta2_em = now() where id = r.id;
    end if;

    v_titulo := 'Você fechou o serviço?';
    v_corpo := left(
      coalesce(nullif(trim(coalesce(r.titulo, '')), ''), 'Serviço')
      || coalesce(' · ' || nullif(trim(coalesce(r.bairro, '')), ''), '')
      || coalesce(', ' || nullif(trim(coalesce(r.cidade, '')), ''), '')
      || '. Conta pra gente, leva 1 segundo.', 400);
    v_rota := '/profissional/pedido/' || r.chamado_id::text;

    -- Aviso dentro do app (alcança quem não tem notificação ativada).
    delete from public.qf_profissional_avisos a
     where a.user_id = r.profissional_id and a.chamado_id = r.chamado_id and a.tipo = 'fechou_pergunta';
    insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
    values (r.profissional_id, r.chamado_id, 'fechou_pergunta', v_titulo, v_corpo, v_rota);

    -- Faixa leve no celular (aviso comum, sem toque de chamado), com os botões Fechei / Não fechei.
    perform net.http_post(
      url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
      body := jsonb_build_object(
        'action', 'user_notice',
        'user_ids', jsonb_build_array(r.profissional_id),
        'title', v_titulo,
        'body', v_corpo,
        'url', '/#' || v_rota,
        'tag', 'qf-fechou-' || r.chamado_id::text,
        'fechou_id', r.id,
        'fechou_token', r.fechou_token),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-qf-internal', coalesce(v_seg, '')),
      timeout_milliseconds := 20000);

    n := n + 1;
  end loop;
  return n;
end;
$function$;

revoke all on function private.qf_perguntar_fechou() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Ainda estou conversando" (dentro do app)
-- ---------------------------------------------------------------------------
create or replace function public.qf_fechou_conversando(p_chamado_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_prof uuid := auth.uid(); v_n integer;
begin
  if v_prof is null then
    raise exception 'authentication required';
  end if;
  update public.qf_desbloqueios
     set fechou_conversando_em = now()
   where chamado_id = p_chamado_id
     and profissional_id = v_prof
     and coalesce(ativo, true)
     and desfecho is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'Este pedido não está mais em conversa com você.');
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.qf_fechou_conversando(uuid) from public, anon;
grant execute on function public.qf_fechou_conversando(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Botões da própria notificação (o aparelho responde sem estar logado: vale a chave do aviso)
-- ---------------------------------------------------------------------------
create or replace function public.qf_fechou_responder_token(p_desbloqueio_id uuid, p_token uuid, p_resposta text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare d record; v_out jsonb;
begin
  select id, chamado_id, profissional_id, desfecho, ativo, fechou_token into d
    from public.qf_desbloqueios
   where id = p_desbloqueio_id;
  if d.id is null or d.fechou_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'reason', 'Aviso inválido.');
  end if;
  if not coalesce(d.ativo, true) or d.desfecho is not null then
    return jsonb_build_object('ok', true, 'ja_respondido', true);
  end if;

  if p_resposta = 'conversando' then
    update public.qf_desbloqueios set fechou_conversando_em = now() where id = d.id;
    return jsonb_build_object('ok', true, 'resposta', 'conversando');
  end if;
  if p_resposta not in ('fechei', 'nao_fechei') then
    return jsonb_build_object('ok', false, 'reason', 'Resposta inválida.');
  end if;

  -- Responde em nome do profissional dono do aviso, pela mesma regra do botão do app.
  perform set_config('request.jwt.claim.sub', d.profissional_id::text, true);
  v_out := public.qf_profissional_fechar_chamado(d.chamado_id, p_resposta = 'fechei');
  perform set_config('request.jwt.claim.sub', '', true);
  return coalesce(v_out, '{}'::jsonb) || jsonb_build_object('chamado_id', d.chamado_id);
end;
$function$;

revoke all on function public.qf_fechou_responder_token(uuid, uuid, text) from public;
grant execute on function public.qf_fechou_responder_token(uuid, uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Painel admin: "Fechou? · sem resposta"
-- ---------------------------------------------------------------------------
create or replace function public.qf_admin_fechou_respostas()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  return jsonb_build_object(
    'ok', true,
    'agora', now(),
    'resumo', (
      select jsonb_build_object(
        'ativos', count(*),
        'fechei', count(*) filter (where d.desfecho = 'fechado'),
        'nao_fechei', count(*) filter (where d.desfecho = 'nao_fechado'),
        'sem_resposta', count(*) filter (where d.desfecho is null),
        'conversando', count(*) filter (where d.desfecho is null and d.fechou_conversando_em is not null),
        'perguntados', count(*) filter (where d.desfecho is null and d.fechou_pergunta1_em is not null)
      )
      from public.qf_desbloqueios d
      where coalesce(d.ativo, true)
    ),
    'itens', coalesce((
      select jsonb_agg(x.j order by x.ordem, x.criado_em desc)
      from (
        select d.criado_em,
               case when d.desfecho is null and c.status in ('em_negociacao', 'confirmado', 'em_andamento') then 0 else 1 end as ordem,
               jsonb_build_object(
                 'desbloqueio_id', d.id,
                 'chamado_id', d.chamado_id,
                 'profissional_id', d.profissional_id,
                 'profissional', coalesce(pf.nome, 'Profissional'),
                 'whatsapp', coalesce(nullif(pf.whatsapp, ''), pf.telefone),
                 'titulo', c.titulo,
                 'bairro', c.bairro,
                 'cidade', c.cidade,
                 'status_pedido', c.status,
                 'desbloqueou_em', d.criado_em,
                 'pergunta1_em', d.fechou_pergunta1_em,
                 'pergunta2_em', d.fechou_pergunta2_em,
                 'conversando_em', d.fechou_conversando_em,
                 'desfecho', d.desfecho,
                 'desfecho_em', d.desfecho_em
               ) as j
        from public.qf_desbloqueios d
        join public.qf_chamados c on c.id = d.chamado_id
        left join public.qf_profiles pf on pf.id = d.profissional_id
        where coalesce(d.ativo, true)
          and d.criado_em >= now() - interval '30 days'
        order by 2, d.criado_em desc
        limit 300
      ) x
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.qf_admin_fechou_respostas() from public, anon;
grant execute on function public.qf_admin_fechou_respostas() to authenticated;

-- Rotina a cada 5 minutos.
select cron.unschedule(jobid) from cron.job where jobname = 'qf-perguntar-fechou';
select cron.schedule('qf-perguntar-fechou', '*/5 * * * *', 'select private.qf_perguntar_fechou();');
