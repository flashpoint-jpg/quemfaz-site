-- V11.81: pedido urgente só é publicado depois que o Pix é aprovado.
-- O chamado nasce com status 'aguardando_pagamento': nenhum gatilho de envio (cascata, push, aviso de
-- sem profissional) dispara, porque todos exigem status 'aberto'. Quando o Pix cai, o pagamento aprovado
-- muda o chamado para 'aberto' + prioridade, e o gatilho qf_reabrir_busca inicia a cascata e o push.

do $$
declare v_nome text;
begin
  select conname into v_nome from pg_constraint
   where conrelid = 'public.qf_chamados'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%status%' and pg_get_constraintdef(oid) ilike '%em_negociacao%';
  if v_nome is not null then execute format('alter table public.qf_chamados drop constraint %I', v_nome); end if;
end $$;
alter table public.qf_chamados add constraint qf_chamados_status_check check (status = any (array[
  'aberto','em_negociacao','confirmado','em_andamento','concluido','finalizado','cancelado','expirado','aguardando_pagamento'
]));

create or replace function public.qf_solicitar_prioridade(p_chamado_id uuid, p_metodo text default 'pix')
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_valor integer := 990;
  v_id uuid;
  v_status text;
  v_checkout text;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_metodo not in ('pix','cartao','boleto') then raise exception 'invalid payment method'; end if;
  if not exists (
    select 1 from public.qf_chamados c
    where c.id = p_chamado_id and c.cliente_id = v_uid and c.status in ('aberto','aguardando_pagamento')
  ) then
    raise exception 'call not found or unavailable';
  end if;

  select coalesce((valor->>'valor_centavos')::integer, 990) into v_valor
  from public.qf_config where chave = 'prioridade_cliente';
  v_valor := coalesce(v_valor, 990);

  select id, status, checkout_url into v_id, v_status, v_checkout
  from public.qf_prioridade_pagamentos
  where chamado_id = p_chamado_id and cliente_id = v_uid;

  if v_id is not null then
    return jsonb_build_object('ok', true, 'pagamento_id', v_id, 'status', v_status,
      'valor_centavos', v_valor, 'checkout_url', v_checkout, 'prioridade_ativa', v_status = 'aprovado');
  end if;

  insert into public.qf_prioridade_pagamentos(chamado_id, cliente_id, valor_centavos, metodo, status)
  values (p_chamado_id, v_uid, v_valor, p_metodo, 'pendente')
  returning id, status, checkout_url into v_id, v_status, v_checkout;

  return jsonb_build_object('ok', true, 'pagamento_id', v_id, 'status', v_status,
    'valor_centavos', v_valor, 'checkout_url', v_checkout, 'prioridade_ativa', false);
end;
$function$;

create or replace function public.qf_prioridade_pagamento_aplicado()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_publicado public.qf_chamados%rowtype;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    -- Pedido urgente que esperava o Pix: publica agora, já prioritário.
    update public.qf_chamados
       set status = 'aberto', prioridade = true, criado_em = now(), atualizado_em = now()
     where id = new.chamado_id and cliente_id = new.cliente_id and status = 'aguardando_pagamento'
    returning * into v_publicado;

    if v_publicado.id is not null then
      begin
        if not exists (
          select 1 from public.qf_profissionais pr join public.qf_profiles pf on pf.id = pr.user_id
          where coalesce(pf.ativo, true) and pr.user_id <> v_publicado.cliente_id and v_publicado.categoria = any(pr.especialidades)
        ) then
          perform private.qf_admin_recado(
            '⚠️ Pedido sem profissional: ' || coalesce(nullif(trim(v_publicado.titulo), ''), 'Serviço'),
            concat_ws(' · ', nullif(trim(v_publicado.bairro), ''), nullif(concat_ws('/', v_publicado.cidade, v_publicado.uf), '')) ||
              ' — ninguém cadastrado nesse serviço, então ninguém foi avisado. Abra o painel e decida para quem mandar.',
            '/admin.html#/admin/sem-profissional',
            'qf-sem-prof-' || v_publicado.id::text);
        end if;
      exception when others then
        raise warning 'QuemFaz aviso urgente sem profissional: %', sqlerrm;
      end;
    else
      update public.qf_chamados set prioridade = true, atualizado_em = now()
       where id = new.chamado_id and cliente_id = new.cliente_id and status = 'aberto';
    end if;

    begin
      perform private.qf_push_interno('priority_boost', new.chamado_id);
    exception when others then
      raise warning 'QuemFaz boost prioridade: %', sqlerrm;
    end;

  elsif new.status in ('cancelado','expirado','estornado') and old.status = 'aprovado' then
    update public.qf_chamados set prioridade = false, atualizado_em = now()
     where id = new.chamado_id and cliente_id = new.cliente_id and status = 'aberto';
  end if;
  return null;
end;
$function$;

-- Pedido urgente que nunca foi pago some sozinho depois de 2 dias (o Pix vale 24 h).
create or replace function private.qf_expirar_urgentes_nao_pagos()
returns integer language sql security definer set search_path to '' as $function$
  with alvo as (
    update public.qf_chamados set status = 'expirado', atualizado_em = now()
     where status = 'aguardando_pagamento' and criado_em < now() - interval '2 days'
    returning 1)
  select count(*)::integer from alvo;
$function$;
select cron.unschedule(jobid) from cron.job where jobname = 'qf-expirar-urgentes-nao-pagos';
select cron.schedule('qf-expirar-urgentes-nao-pagos', '23 * * * *', 'select private.qf_expirar_urgentes_nao_pagos();');

-- Contador de movimento dos profissionais não conta pedido que ainda não foi publicado.
create or replace function public.qf_movimento_pedidos()
returns jsonb language sql stable security definer set search_path to '' as $function$
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
  where c.status not in ('cancelado','aguardando_pagamento')
    and c.criado_em >= now() - interval '7 days';
$function$;
