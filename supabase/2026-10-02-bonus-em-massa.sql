-- QuemFaz V11.19.0 — admin: bônus em massa (créditos) só para quem ainda não recebeu.
-- Rodada "lancamento" = os R$ 25 do cadastro (mesmo lançamento que o cadastro já faz sozinho;
-- o índice único qf_mov_bonus_lancamento_unico impede receber duas vezes).
-- Qualquer outra rodada é identificada pelo nome: quem já tem um bônus com aquele nome fica de fora.

create or replace function private.qf_bonus_massa_descricao(p_rodada text, p_valor_centavos integer)
returns text
language sql
immutable
set search_path to ''
as $$
  select case when lower(btrim(coalesce(p_rodada, ''))) in ('', 'lancamento')
    then 'Bônus de lançamento QuemFaz — R$ 25,00'
    else 'Bônus QuemFaz: ' || btrim(p_rodada) end;
$$;

-- Quem falta receber a rodada (sem enviar nada).
create or replace function public.qf_admin_bonus_massa_resumo(p_rodada text default 'lancamento')
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_lanc boolean := lower(btrim(coalesce(p_rodada, ''))) in ('', 'lancamento');
  v_desc text := private.qf_bonus_massa_descricao(p_rodada, 0);
  v_total integer;
  v_faltam jsonb;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if not v_lanc and char_length(btrim(p_rodada)) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'Nome do bônus muito longo (máximo 60 letras).');
  end if;
  select count(*) into v_total from public.qf_profissionais;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'nome', x.nome, 'cidade', x.cidade, 'uf', x.uf) order by x.nome), '[]'::jsonb)
    into v_faltam
  from (
    select pr.user_id, coalesce(nullif(btrim(pf.nome), ''), 'Sem nome') as nome, pf.cidade, pf.uf
    from public.qf_profissionais pr
    left join public.qf_profiles pf on pf.id = pr.user_id
    where not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.profissional_id = pr.user_id and m.tipo = 'bonus'
        and ((v_lanc and m.referencia_tipo = 'bonus_lancamento')
          or (not v_lanc and m.referencia_tipo = 'bonus_massa' and lower(m.descricao) = lower(v_desc)))
    )
  ) x;
  return jsonb_build_object('ok', true, 'rodada', case when v_lanc then 'lancamento' else btrim(p_rodada) end,
    'total', v_total, 'faltam', jsonb_array_length(v_faltam), 'ja_receberam', v_total - jsonb_array_length(v_faltam),
    'lista', v_faltam);
end;
$$;

-- Envia o bônus para todos que ainda não receberam aquela rodada.
create or replace function public.qf_admin_bonus_massa_enviar(p_rodada text default 'lancamento', p_valor_centavos integer default 2500)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_lanc boolean := lower(btrim(coalesce(p_rodada, ''))) in ('', 'lancamento');
  v_valor integer := case when lower(btrim(coalesce(p_rodada, ''))) in ('', 'lancamento') then 2500 else coalesce(p_valor_centavos, 0) end;
  v_desc text := private.qf_bonus_massa_descricao(p_rodada, 0);
  v_enviados integer := 0;
begin
  if not private.qf_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'sem_permissao');
  end if;
  if not v_lanc and char_length(btrim(p_rodada)) > 60 then
    return jsonb_build_object('ok', false, 'reason', 'Nome do bônus muito longo (máximo 60 letras).');
  end if;
  if v_valor < 100 or v_valor > 10000 then
    return jsonb_build_object('ok', false, 'reason', 'O valor do bônus precisa ficar entre R$ 1,00 e R$ 100,00.');
  end if;

  -- Trava: dois cliques ao mesmo tempo não pagam a mesma rodada em dobro.
  perform pg_advisory_xact_lock(hashtext('qf_bonus_massa:' || lower(v_desc)));

  with alvo as (
    select pr.user_id
    from public.qf_profissionais pr
    where not exists (
      select 1 from public.qf_movimentacoes_carteira m
      where m.profissional_id = pr.user_id and m.tipo = 'bonus'
        and ((v_lanc and m.referencia_tipo = 'bonus_lancamento')
          or (not v_lanc and m.referencia_tipo = 'bonus_massa' and lower(m.descricao) = lower(v_desc)))
    )
  ), mov as (
    insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, descricao)
    select a.user_id, 'bonus', v_valor, case when v_lanc then 'bonus_lancamento' else 'bonus_massa' end, v_desc
    from alvo a
    on conflict do nothing
    returning profissional_id
  ), cart as (
    insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
    select m.profissional_id, v_valor, 0, true from mov m
    on conflict (profissional_id) do update
      set saldo_centavos = public.qf_carteiras.saldo_centavos + excluded.saldo_centavos, atualizado_em = now()
    returning 1
  )
  select count(*) into v_enviados from cart;

  return jsonb_build_object('ok', true, 'enviados', v_enviados, 'valor_centavos', v_valor,
    'rodada', case when v_lanc then 'lancamento' else btrim(p_rodada) end);
end;
$$;

revoke all on function public.qf_admin_bonus_massa_resumo(text) from public, anon;
revoke all on function public.qf_admin_bonus_massa_enviar(text, integer) from public, anon;
grant execute on function public.qf_admin_bonus_massa_resumo(text) to authenticated;
grant execute on function public.qf_admin_bonus_massa_enviar(text, integer) to authenticated;
