-- Estrutura mínima (copiada do banco real, só o que recargas/planos/carteira usam) para testar
-- supabase/migrations/20261018190000_pagamentos_auditoria_contabilidade.sql em um Postgres isolado.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth; create schema private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create table public.qf_admins (user_id uuid primary key, criado_em timestamptz not null default now());
create function private.qf_is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and exists(select 1 from public.qf_admins a where a.user_id = auth.uid()) $$;

create table public.qf_profissionais (user_id uuid primary key);
create table public.qf_carteiras (
  profissional_id uuid primary key, saldo_centavos bigint not null default 0,
  bonus_inicial_centavos bigint default 0, bonus_inicial_usado boolean default false, atualizado_em timestamptz default now());
create table public.qf_movimentacoes_carteira (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  tipo text not null check (tipo in ('credito','debito','bonus','estorno','ajuste_admin')),
  valor_centavos bigint not null check (valor_centavos > 0),
  referencia_tipo text, referencia_id uuid, descricao text, criado_em timestamptz not null default now());
create unique index qf_mov_recarga_credito_unico on public.qf_movimentacoes_carteira(referencia_id)
  where referencia_tipo = 'recarga' and tipo = 'credito' and referencia_id is not null;

create table public.qf_recargas (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  valor_centavos integer not null check (valor_centavos > 0),
  metodo text not null check (metodo in ('pix','cartao','boleto')),
  status text not null default 'pendente' check (status in ('pendente','aprovado','cancelado','expirado','estornado')),
  provedor text, provedor_id text, criado_em timestamptz not null default now(), aprovado_em timestamptz,
  checkout_url text, atualizado_em timestamptz not null default now(),
  plano text check (plano in ('mensal','pro','premium')));
create unique index qf_recargas_provedor_id_unico on public.qf_recargas(provedor_id) where provedor_id is not null;

create table public.qf_planos_catalogo (plano text primary key, nome text, preco_centavos integer, chamados integer, dias integer, ativo boolean default true);
create table public.qf_planos_catalogo_hist (plano text, preco_centavos integer, chamados integer, dias integer, substituido_em timestamptz);
create table public.qf_planos_profissional (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references public.qf_profissionais(user_id) on delete cascade,
  plano text not null check (plano in ('mensal','pro','premium')),
  chamados_total integer not null check (chamados_total > 0),
  chamados_restantes integer not null check (chamados_restantes >= 0),
  valido_ate timestamptz not null, recarga_id uuid unique references public.qf_recargas(id) on delete set null,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  anuncio_id uuid, origem text, ativado_por uuid);
create table public.qf_desbloqueios (
  id uuid primary key default gen_random_uuid(), chamado_id uuid, profissional_id uuid, valor_centavos integer,
  origem text, criado_em timestamptz not null default now(), ativo boolean default true, plano_id uuid);

-- Funções do banco real que o fluxo chama.
create function public.qf_recarga_timestamps() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.atualizado_em := now();
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then new.aprovado_em := coalesce(new.aprovado_em, now()); end if;
  return new;
end $$;
-- Bônus de recarga: cópia da regra de antes do corte de 16/10 (5% a partir de R$ 50), para exercitar o caminho do bônus.
create function public.qf_bonus_recarga_centavos(p_valor_centavos integer) returns integer language sql stable as $$
  select case when p_valor_centavos >= 5000 then (p_valor_centavos * 5 / 100) else 0 end $$;
create table public.qf_bonus_validade (profissional_id uuid primary key, saldo_bonus_centavos bigint, expira_em timestamptz);
create function private.qf_expirar_bonus_profissional(uuid) returns void language sql as $$ select $$;
create function private.qf_bonus_prazo_nova_concessao() returns trigger language plpgsql as $$
begin
  if new.tipo = 'bonus' and new.referencia_tipo = 'bonus_recarga' then
    insert into public.qf_bonus_validade values (new.profissional_id, new.valor_centavos, now() + interval '30 days')
    on conflict (profissional_id) do update set saldo_bonus_centavos = public.qf_bonus_validade.saldo_bonus_centavos + excluded.saldo_bonus_centavos;
  end if;
  return new;
end $$;
create trigger qf_bonus_prazo_nova_concessao after insert on public.qf_movimentacoes_carteira
  for each row execute function private.qf_bonus_prazo_nova_concessao();
create trigger qf_recarga_timestamps before update on public.qf_recargas for each row execute function public.qf_recarga_timestamps();

-- Versão ANTIGA do gatilho de aprovação (a do banco real hoje): serve de ponto de partida e prova a falha corrigida.
create function public.qf_recarga_pagamento_aplicado() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare c public.qf_planos_catalogo; v_sobra integer; v_chamados integer; v_dias integer; v_bonus integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    if new.plano is not null then
      select * into c from public.qf_planos_catalogo where plano = new.plano;
      if c.plano is not null then
        if new.valor_centavos = c.preco_centavos then v_chamados := c.chamados; v_dias := c.dias;
        else
          select h.chamados, h.dias into v_chamados, v_dias from public.qf_planos_catalogo_hist h
           where h.plano = new.plano and h.preco_centavos = new.valor_centavos and h.substituido_em >= new.criado_em order by h.substituido_em limit 1;
        end if;
      end if;
      if v_chamados is not null then
        if not exists (select 1 from public.qf_planos_profissional where recarga_id = new.id) then
          select coalesce(sum(chamados_restantes),0) into v_sobra from public.qf_planos_profissional
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          update public.qf_planos_profissional set chamados_restantes = 0, atualizado_em = now()
           where profissional_id = new.profissional_id and valido_ate > now() and chamados_restantes > 0;
          insert into public.qf_planos_profissional(profissional_id, plano, chamados_total, chamados_restantes, valido_ate, recarga_id)
          values (new.profissional_id, c.plano, v_chamados, v_chamados + v_sobra, now() + make_interval(days => v_dias), new.id);
        end if;
        return null;
      end if;
    end if;
    if not exists (select 1 from public.qf_movimentacoes_carteira m where m.referencia_tipo = 'recarga' and m.referencia_id = new.id and m.tipo = 'credito') then
      insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado) values (new.profissional_id, 0, 0, false) on conflict (profissional_id) do nothing;
      update public.qf_carteiras set saldo_centavos = saldo_centavos + new.valor_centavos, atualizado_em = now() where profissional_id = new.profissional_id;
      insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
      values (new.profissional_id, 'credito', new.valor_centavos, 'recarga', new.id, 'Recarga aprovada via ' || new.metodo);
    end if;
  end if;
  return null;
end $function$;
create trigger qf_recarga_pagamento_aplicado after update of status on public.qf_recargas for each row execute function public.qf_recarga_pagamento_aplicado();

-- Ajuste manual: versão ANTIGA do banco real (valor negativo grava tipo inexistente e valor negativo).
create function public.qf_admin_adicionar_creditos(p_user_id uuid, p_valor_centavos integer, p_descricao text default null) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if auth.uid() is null or not exists(select 1 from public.qf_admins where user_id=auth.uid()) then raise exception 'forbidden'; end if;
  if coalesce(p_valor_centavos,0)=0 then return jsonb_build_object('ok',false,'reason','valor_invalido'); end if;
  insert into public.qf_carteiras(profissional_id,saldo_centavos,bonus_inicial_centavos,bonus_inicial_usado) values(p_user_id,0,0,false) on conflict(profissional_id) do nothing;
  update public.qf_carteiras set saldo_centavos=saldo_centavos+p_valor_centavos, atualizado_em=now() where profissional_id=p_user_id;
  insert into public.qf_movimentacoes_carteira(profissional_id,tipo,valor_centavos,referencia_tipo,descricao)
  values(p_user_id,case when p_valor_centavos>0 then 'credito' else 'ajuste' end,p_valor_centavos,'admin',coalesce(nullif(trim(p_descricao),''),'Ajuste do administrador'));
  return jsonb_build_object('ok',true);
end $function$;
