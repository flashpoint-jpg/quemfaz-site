-- QuemFaz 11.55 — planos dos profissionais no painel: editar preço/quantidade e ver quem assinou.
-- (já aplicado no Supabase em 10/10/2026)

-- Histórico de preço: quem gerou o Pix com o preço antigo e pagou depois da troca ainda recebe o plano.
create table if not exists public.qf_planos_catalogo_hist (
  id bigint generated always as identity primary key,
  plano text not null,
  preco_centavos integer not null,
  chamados integer not null,
  dias integer not null,
  substituido_em timestamptz not null default now(),
  por uuid
);
create index if not exists qf_planos_catalogo_hist_plano_idx on public.qf_planos_catalogo_hist (plano, preco_centavos, substituido_em);
alter table public.qf_planos_catalogo_hist enable row level security;
revoke all on public.qf_planos_catalogo_hist from anon, authenticated;

-- Pagamento aprovado vira plano. Aceita o preço de hoje ou o que valia quando a cobrança foi criada.
create or replace function public.qf_recarga_pagamento_aplicado()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c public.qf_planos_catalogo; v_sobra integer; v_chamados integer; v_dias integer;
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    if new.plano is not null then
      select * into c from public.qf_planos_catalogo where plano = new.plano;
      if c.plano is not null then
        if new.valor_centavos = c.preco_centavos then
          v_chamados := c.chamados; v_dias := c.dias;
        else
          select h.chamados, h.dias into v_chamados, v_dias
            from public.qf_planos_catalogo_hist h
           where h.plano = new.plano and h.preco_centavos = new.valor_centavos and h.substituido_em >= new.criado_em
           order by h.substituido_em
           limit 1;
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
end $function$;

-- Admin muda preço, quantidade de chamados e validade de um plano. Vale na hora para novas assinaturas.
create or replace function public.qf_admin_salvar_plano(p_plano text, p_preco_centavos integer, p_chamados integer, p_dias integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c public.qf_planos_catalogo;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if p_preco_centavos is null or p_preco_centavos < 100 or p_preco_centavos > 500000 then
    return jsonb_build_object('ok', false, 'reason', 'Use um preço de R$ 1 a R$ 5.000.');
  end if;
  if p_chamados is null or p_chamados < 1 or p_chamados > 1000 then
    return jsonb_build_object('ok', false, 'reason', 'Use de 1 a 1.000 chamados.');
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 365 then
    return jsonb_build_object('ok', false, 'reason', 'Use de 1 a 365 dias.');
  end if;
  select * into c from public.qf_planos_catalogo where plano = p_plano for update;
  if c.plano is null then
    return jsonb_build_object('ok', false, 'reason', 'Plano não encontrado.');
  end if;
  if c.preco_centavos <> p_preco_centavos or c.chamados <> p_chamados or c.dias <> p_dias then
    insert into public.qf_planos_catalogo_hist(plano, preco_centavos, chamados, dias, por)
    values (c.plano, c.preco_centavos, c.chamados, c.dias, auth.uid());
    update public.qf_planos_catalogo
       set preco_centavos = p_preco_centavos, chamados = p_chamados, dias = p_dias
     where plano = p_plano;
  end if;
  return jsonb_build_object('ok', true) || public.qf_admin_planos_painel();
end;
$function$;
revoke all on function public.qf_admin_salvar_plano(text, integer, integer, integer) from public, anon;
grant execute on function public.qf_admin_salvar_plano(text, integer, integer, integer) to authenticated;

-- Página "Planos dos profissionais" do painel: catálogo + quem assinou ou tentou assinar.
create or replace function public.qf_admin_planos_painel()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare v_planos jsonb; v_lista jsonb;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'plano', c.plano, 'nome', c.nome, 'preco_centavos', c.preco_centavos, 'chamados', c.chamados, 'dias', c.dias,
           'ativos', (select count(*) from public.qf_planos_profissional pp
                       where pp.plano = c.plano and pp.valido_ate > now() and pp.chamados_restantes > 0)
         ) order by c.preco_centavos), '[]'::jsonb)
    into v_planos
    from public.qf_planos_catalogo c;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.criado_em desc), '[]'::jsonb)
    into v_lista
    from (
      select r.id, 'conta' as origem, p.nome, coalesce(p.whatsapp, p.telefone) as telefone, p.email,
             r.plano, r.valor_centavos, r.metodo, r.criado_em, r.aprovado_em,
             case when r.status = 'aprovado' then 'pago'
                  when r.status = 'pendente' and r.provedor_id is null then 'nao_gerou'
                  when r.status = 'pendente' and r.metodo = 'pix' and r.criado_em < now() - interval '24 hours' then 'vencido'
                  when r.status = 'pendente' and r.criado_em < now() - interval '4 days' then 'vencido'
                  when r.status = 'pendente' then 'aguardando'
                  else 'cancelado' end as situacao,
             pp.chamados_restantes, pp.chamados_total, pp.valido_ate
        from public.qf_recargas r
        left join public.qf_profiles p on p.id = r.profissional_id
        left join public.qf_planos_profissional pp on pp.recarga_id = r.id
       where r.plano is not null
      union all
      select g.id, 'cadastro', g.nome, g.telefone, g.email,
             g.plano, g.valor_centavos, g.metodo, g.criado_em, g.aprovado_em,
             case when g.status = 'aprovado' then 'pago_sem_conta'
                  when g.status = 'pendente' and g.provedor_id is null then 'nao_gerou'
                  when g.status = 'pendente' and g.metodo = 'pix' and g.criado_em < now() - interval '24 hours' then 'vencido'
                  when g.status = 'pendente' and g.criado_em < now() - interval '4 days' then 'vencido'
                  when g.status = 'pendente' then 'aguardando'
                  else 'cancelado' end,
             null::integer, null::integer, null::timestamptz
        from public.qf_pre_cadastro_pagamentos g
       where g.profissional_id is null and g.email not ilike '%@exemplo.com'
      order by criado_em desc
      limit 300
    ) x;

  return jsonb_build_object('ok', true, 'planos', v_planos, 'lista', v_lista);
end;
$function$;
revoke all on function public.qf_admin_planos_painel() from public, anon;
grant execute on function public.qf_admin_planos_painel() to authenticated;
