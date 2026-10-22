-- QuemFaz 11.10.1 — Planos Mensal e Pro comprados dentro do app (Efí), sem nada manual.
-- Compra: qf_solicitar_plano cria um pagamento em qf_recargas com a coluna "plano".
-- Quando a Efí confirma (status -> aprovado), o gatilho que já credita recargas ativa o plano
-- em vez de pôr dinheiro na carteira. Desbloqueio usa primeiro o plano; devolução de lead
-- devolve o chamado para o plano.

-- 1) Catálogo (preço decidido no servidor)
create table if not exists public.qf_planos_catalogo (
  plano text primary key check (plano in ('mensal','pro')),
  nome text not null,
  preco_centavos integer not null check (preco_centavos > 0),
  chamados integer not null check (chamados > 0),
  dias integer not null check (dias > 0),
  ativo boolean not null default true
);
alter table public.qf_planos_catalogo enable row level security;
drop policy if exists qf_planos_catalogo_select_all on public.qf_planos_catalogo;
create policy qf_planos_catalogo_select_all on public.qf_planos_catalogo for select to anon, authenticated using (true);
grant select on public.qf_planos_catalogo to anon, authenticated;
insert into public.qf_planos_catalogo(plano,nome,preco_centavos,chamados,dias,ativo) values
  ('mensal','Mensal',4990,10,30,true),
  ('pro','Pro',9990,25,30,true)
on conflict (plano) do nothing;

-- 2) Planos comprados
create table if not exists public.qf_planos_profissional (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  plano text not null check (plano in ('mensal','pro')),
  chamados_total integer not null check (chamados_total > 0),
  chamados_restantes integer not null check (chamados_restantes >= 0),
  valido_ate timestamptz not null,
  recarga_id uuid unique references public.qf_recargas(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists qf_planos_profissional_prof_idx on public.qf_planos_profissional(profissional_id, valido_ate desc);
alter table public.qf_planos_profissional enable row level security;
drop policy if exists qf_planos_profissional_select_own on public.qf_planos_profissional;
create policy qf_planos_profissional_select_own on public.qf_planos_profissional for select to authenticated
  using (profissional_id = (select auth.uid()));
grant select on public.qf_planos_profissional to authenticated;

-- 3) Pagamento de plano usa qf_recargas
alter table public.qf_recargas add column if not exists plano text check (plano in ('mensal','pro'));
-- Cliente não pode criar pagamento de plano direto na tabela (só pela função, com preço do servidor).
drop policy if exists qf_recargas_insert_own on public.qf_recargas;
create policy qf_recargas_insert_own on public.qf_recargas for insert
  with check ((profissional_id = (select auth.uid())) and (status = 'pendente') and (aprovado_em is null) and (plano is null));

-- 4) Desbloqueio pode vir do plano
alter table public.qf_desbloqueios drop constraint if exists qf_desbloqueios_origem_check;
alter table public.qf_desbloqueios add constraint qf_desbloqueios_origem_check
  check (origem = any (array['saldo','bonus','cortesia_admin','plano']));
alter table public.qf_desbloqueios add column if not exists plano_id uuid references public.qf_planos_profissional(id) on delete set null;

-- 5) Pedir plano
create or replace function public.qf_solicitar_plano(p_plano text, p_metodo text default 'pix')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); c public.qf_planos_catalogo; v_id uuid;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.qf_profissionais p where p.user_id = v_uid) then raise exception 'professional profile required'; end if;
  if p_metodo not in ('pix','cartao','boleto') then raise exception 'invalid payment method'; end if;
  select * into c from public.qf_planos_catalogo where plano = p_plano and ativo;
  if c.plano is null then raise exception 'invalid plan'; end if;
  insert into public.qf_recargas(profissional_id, valor_centavos, metodo, status, plano)
  values (v_uid, c.preco_centavos, p_metodo, 'pendente', c.plano)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'recarga_id', v_id, 'status', 'pendente', 'valor_centavos', c.preco_centavos,
                            'metodo', p_metodo, 'plano', c.plano, 'chamados', c.chamados, 'dias', c.dias);
end $$;
revoke all on function public.qf_solicitar_plano(text, text) from public, anon;
grant execute on function public.qf_solicitar_plano(text, text) to authenticated;

-- 6) Ativar plano quando o pagamento é aprovado
create or replace function public.qf_recarga_pagamento_aplicado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare c public.qf_planos_catalogo; v_sobra integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    if new.plano is not null then
      select * into c from public.qf_planos_catalogo where plano = new.plano;
      -- Só ativa se o valor pago for o preço do plano. Se não bater, vira crédito normal (ninguém perde dinheiro).
      if c.plano is not null and new.valor_centavos = c.preco_centavos then
        if not exists (select 1 from public.qf_planos_profissional where recarga_id = new.id) then
          -- Chamados que sobraram de um plano ainda válido passam para o novo.
          select coalesce(sum(chamados_restantes),0) into v_sobra from public.qf_planos_profissional
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, recarga_id)
          values (new.profissional_id, c.plano, c.chamados, c.chamados + v_sobra, now() + make_interval(days => c.dias), new.id);
        end if;
        return null;
      end if;
    end if;
    if not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.referencia_tipo = 'recarga' and m.referencia_id = new.id and m.tipo = 'credito'
    ) then
      insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
      values (new.profissional_id, 0, 0, false)
      on conflict (profissional_id) do nothing;
      update public.qf_carteiras set saldo_centavos = saldo_centavos + new.valor_centavos, atualizado_em = now()
       where profissional_id = new.profissional_id;
      insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (new.profissional_id, 'credito', new.valor_centavos, 'recarga', new.id,
        'Recarga aprovada via ' || case new.metodo when 'pix' then 'Pix' when 'cartao' then 'Cartão' when 'boleto' then 'Boleto' else new.metodo end);
    end if;
  end if;
  return null;
end $$;

-- 7) Desbloquear: usa o plano antes do saldo
create or replace function public.qf_desbloquear_chamado(p_chamado_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_prof uuid := auth.uid();
  v_preco integer;
  v_saldo bigint;
  v_status text;
  v_existing_valor integer;
  v_existing_origem text;
  v_existing_ativo boolean;
  v_plano_id uuid;
  v_plano_restantes integer;
begin
  if v_prof is null then
    raise exception 'authentication required';
  end if;

  if not exists(select 1 from public.qf_profissionais where user_id = v_prof) then
    raise exception 'professional profile required';
  end if;

  if not exists(
    select 1 from public.qf_profiles
    where id=v_prof
      and nullif(trim(coalesce(foto_url,'')),'') is not null
  ) then
    return jsonb_build_object('ok',false,'reason','selfie_obrigatoria');
  end if;

  select d.valor_centavos, d.origem, d.ativo
    into v_existing_valor, v_existing_origem, v_existing_ativo
  from public.qf_desbloqueios d
  where d.chamado_id = p_chamado_id
    and d.profissional_id = v_prof
  limit 1;

  if found then
    if coalesce(v_existing_ativo,true) then
      return jsonb_build_object(
        'ok',true,
        'already_unlocked',true,
        'origem',coalesce(v_existing_origem,'saldo'),
        'preco_centavos',coalesce(v_existing_valor,0),
        'usou_bonus',false
      );
    end if;
    return jsonb_build_object('ok',false,'reason','ja_participou');
  end if;

  if not exists(
    select 1
    from public.qf_listar_chamados_disponiveis() d
    where d.id = p_chamado_id
  ) then
    return jsonb_build_object('ok',false,'reason','nao_elegivel');
  end if;

  select c.status,
         coalesce(p.preco_centavos,padrao.preco_centavos,790)
    into v_status,v_preco
  from public.qf_chamados c
  left join public.qf_precos_desbloqueio p
    on p.categoria=c.categoria and p.ativo
  left join public.qf_precos_desbloqueio padrao
    on padrao.categoria='padrao'
  where c.id=p_chamado_id
  for update of c;

  if v_status is null then
    raise exception 'call not found';
  end if;

  if v_status <> 'aberto' then
    return jsonb_build_object('ok',false,'reason','indisponivel');
  end if;

  -- Plano ativo com chamados: usa o que vence primeiro.
  select id, chamados_restantes into v_plano_id, v_plano_restantes
    from public.qf_planos_profissional
   where profissional_id = v_prof and valido_ate > now() and chamados_restantes > 0
   order by valido_ate asc
   limit 1
   for update;

  if v_plano_id is not null then
    update public.qf_planos_profissional
       set chamados_restantes = chamados_restantes - 1, atualizado_em = now()
     where id = v_plano_id;

    insert into public.qf_desbloqueios(chamado_id,profissional_id,valor_centavos,origem,ativo,plano_id)
    values(p_chamado_id,v_prof,0,'plano',true,v_plano_id);

    update public.qf_chamados set status='em_negociacao', atualizado_em=now() where id=p_chamado_id;

    return jsonb_build_object(
      'ok',true,
      'origem','plano',
      'usou_bonus',false,
      'preco_centavos',0,
      'preco_tabela_centavos',v_preco,
      'plano_restantes',v_plano_restantes-1
    );
  end if;

  insert into public.qf_carteiras(
    profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado
  )
  values(v_prof,0,0,true)
  on conflict(profissional_id) do update
  set bonus_inicial_usado=true;

  select saldo_centavos
    into v_saldo
  from public.qf_carteiras
  where profissional_id=v_prof
  for update;

  if coalesce(v_saldo,0) < v_preco then
    return jsonb_build_object(
      'ok',false,
      'reason','saldo_insuficiente',
      'preco_centavos',v_preco,
      'saldo_centavos',coalesce(v_saldo,0)
    );
  end if;

  update public.qf_carteiras
     set saldo_centavos=saldo_centavos-v_preco,
         atualizado_em=now()
   where profissional_id=v_prof;

  insert into public.qf_movimentacoes_carteira(
    profissional_id,tipo,valor_centavos,referencia_tipo,referencia_id,descricao
  )
  values(
    v_prof,'debito',v_preco,'chamado',p_chamado_id,'Desbloqueio de chamado'
  );

  insert into public.qf_desbloqueios(
    chamado_id,profissional_id,valor_centavos,origem,ativo
  )
  values(p_chamado_id,v_prof,v_preco,'saldo',true);

  update public.qf_chamados
     set status='em_negociacao',
         atualizado_em=now()
   where id=p_chamado_id;

  return jsonb_build_object(
    'ok',true,
    'origem','saldo',
    'usou_bonus',false,
    'preco_centavos',v_preco,
    'preco_tabela_centavos',v_preco,
    'saldo_centavos',v_saldo-v_preco
  );
exception
  when unique_violation then
    return jsonb_build_object('ok',false,'reason','indisponivel');
end;
$function$;

-- 8) Devolução de lead: chamado do plano volta para o plano
create or replace function qf_private.devolver_lead(p_desbloqueio_id uuid, p_motivo text)
returns integer language plpgsql security definer set search_path to '' as $function$
declare d public.qf_desbloqueios; v_id uuid; v_txt text; v_preco integer;
begin
  select * into d from public.qf_desbloqueios where id = p_desbloqueio_id for update;
  if d.id is null then return 0; end if;

  v_txt := case p_motivo when 'cliente_cancelou' then 'Devolução do lead: o cliente cancelou o pedido'
                         when 'chamado_expirou' then 'Devolução do lead: o pedido expirou'
                         else 'Devolução do lead: o cliente não respondeu' end;

  if d.origem = 'plano' then
    if not d.ativo or d.plano_id is null then return 0; end if;
    select coalesce(p.preco_centavos, padrao.preco_centavos, 790) into v_preco
      from public.qf_chamados c
      left join public.qf_precos_desbloqueio p on p.categoria = c.categoria and p.ativo
      left join public.qf_precos_desbloqueio padrao on padrao.categoria = 'padrao'
     where c.id = d.chamado_id;
    insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo)
    values (d.id, d.chamado_id, d.profissional_id, coalesce(v_preco, 790), p_motivo)
    on conflict (desbloqueio_id) do nothing returning id into v_id;
    if v_id is null then return 0; end if;
    -- Devolve 1 chamado; se o plano já venceu, esse chamado vale mais 7 dias.
    update public.qf_planos_profissional
       set chamados_restantes = chamados_restantes + 1,
           valido_ate = greatest(valido_ate, now() + interval '7 days'),
           atualizado_em = now()
     where id = d.plano_id;
    update public.qf_desbloqueios set ativo = false where id = d.id;
    insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
    values (d.profissional_id, d.chamado_id, 'lead_devolvido', 'Chamado devolvido ao seu plano',
            v_txt || '. 1 chamado voltou para o seu plano.', '/profissional/carteira')
    on conflict (user_id, chamado_id, tipo) do nothing;
    return 1;
  end if;

  if coalesce(d.valor_centavos, 0) <= 0 or d.origem <> 'saldo' then return 0; end if;
  if not exists (select 1 from public.qf_movimentacoes_carteira m where m.profissional_id = d.profissional_id
                 and m.tipo = 'debito' and m.referencia_tipo = 'chamado' and m.referencia_id = d.chamado_id) then return 0; end if;
  insert into public.qf_devolucoes_lead (desbloqueio_id, chamado_id, profissional_id, valor_centavos, motivo)
  values (d.id, d.chamado_id, d.profissional_id, d.valor_centavos, p_motivo)
  on conflict (desbloqueio_id) do nothing returning id into v_id;
  if v_id is null then return 0; end if;
  insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (d.profissional_id, 0, 0, true) on conflict (profissional_id) do nothing;
  update public.qf_carteiras set saldo_centavos = saldo_centavos + d.valor_centavos, atualizado_em = now()
   where profissional_id = d.profissional_id;
  insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (d.profissional_id, 'estorno', d.valor_centavos, 'chamado', d.chamado_id, v_txt);
  update public.qf_desbloqueios set ativo = false where id = d.id;
  insert into public.qf_profissional_avisos (user_id, chamado_id, tipo, titulo, corpo, rota)
  values (d.profissional_id, d.chamado_id, 'lead_devolvido', 'Crédito devolvido',
          v_txt || '. R$ ' || replace(to_char(d.valor_centavos / 100.0, 'FM999990.00'), '.', ',') || ' voltaram para a sua carteira.', '/profissional/carteira')
  on conflict (user_id, chamado_id, tipo) do nothing;
  return d.valor_centavos;
end $function$;

-- 9) Pedir devolução manual também vale para chamado do plano
create or replace function public.qf_pedir_devolucao_lead(p_chamado_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare v_prof uuid := auth.uid(); d public.qf_desbloqueios; v_status text; v_usados int; v_valor int;
begin
  if v_prof is null then raise exception 'authentication required'; end if;
  select * into d from public.qf_desbloqueios where chamado_id = p_chamado_id and profissional_id = v_prof for update;
  if d.id is null then return jsonb_build_object('ok', false, 'reason', 'sem_desbloqueio'); end if;
  if exists (select 1 from public.qf_devolucoes_lead where desbloqueio_id = d.id) then return jsonb_build_object('ok', false, 'reason', 'ja_devolvido'); end if;
  if not d.ativo then return jsonb_build_object('ok', false, 'reason', 'sem_desbloqueio'); end if;
  if not (d.origem = 'plano' or (d.origem = 'saldo' and coalesce(d.valor_centavos, 0) > 0)) then
    return jsonb_build_object('ok', false, 'reason', 'sem_cobranca');
  end if;
  if d.criado_em > now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'reason', 'aguarde_24h', 'liberado_em', d.criado_em + interval '24 hours');
  end if;
  select status into v_status from public.qf_chamados where id = p_chamado_id for update;
  if v_status <> 'em_negociacao' then return jsonb_build_object('ok', false, 'reason', 'status_invalido', 'status', v_status); end if;
  if exists (select 1 from public.qf_orcamentos o where o.chamado_id = p_chamado_id and o.profissional_id = v_prof and o.status in ('aceito','recusado')) then
    return jsonb_build_object('ok', false, 'reason', 'cliente_respondeu');
  end if;
  select count(*) into v_usados from public.qf_devolucoes_lead
   where profissional_id = v_prof and motivo = 'cliente_nao_respondeu' and criado_em > now() - interval '30 days';
  if v_usados >= 2 then return jsonb_build_object('ok', false, 'reason', 'limite_mensal', 'limite', 2); end if;
  v_valor := qf_private.devolver_lead(d.id, 'cliente_nao_respondeu');
  if v_valor <= 0 then return jsonb_build_object('ok', false, 'reason', 'sem_cobranca'); end if;
  update public.qf_orcamentos set status = 'cancelado', motivo_recusa = 'Sem resposta do cliente (lead devolvido)', atualizado_em = now()
   where chamado_id = p_chamado_id and profissional_id = v_prof and status = 'enviado';
  update public.qf_chamados set status = 'aberto', atualizado_em = now() where id = p_chamado_id and status = 'em_negociacao';
  return jsonb_build_object('ok', true, 'valor_centavos', case when d.origem = 'plano' then 0 else v_valor end,
                            'origem', d.origem, 'usados_30d', v_usados + 1, 'limite', 2);
end $function$;
