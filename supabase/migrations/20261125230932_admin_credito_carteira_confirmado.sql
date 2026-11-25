create or replace function public.qf_admin_creditar_carteira(
  p_user_id uuid, p_valor_centavos integer, p_descricao text, p_operacao_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_descricao text := coalesce(nullif(btrim(p_descricao), ''), 'Crédito manual do administrador');
  v_antes bigint;
  v_depois bigint;
  v_lancamento public.qf_movimentacoes_carteira%rowtype;
begin
  if v_admin is null or not exists(select 1 from public.qf_admins where user_id = v_admin) then
    raise insufficient_privilege using message = 'Sem permissão para adicionar saldo.';
  end if;
  if p_operacao_id is null or coalesce(p_valor_centavos, 0) <= 0 or char_length(v_descricao) > 80 then
    return jsonb_build_object('ok', false, 'reason', 'Dados do lançamento inválidos.');
  end if;
  if not exists(select 1 from public.qf_profissionais where user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'Profissional não encontrado.');
  end if;

  insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (p_user_id, 0, 0, false)
  on conflict (profissional_id) do nothing;

  -- A mesma carteira é bloqueada também por recargas e desbloqueios.
  select saldo_centavos into v_antes from public.qf_carteiras where profissional_id = p_user_id for update;
  select * into v_lancamento from public.qf_movimentacoes_carteira
    where profissional_id = p_user_id and referencia_tipo = 'admin'
      and referencia_id = p_operacao_id and tipo = 'credito';
  if found then
    if v_lancamento.valor_centavos <> p_valor_centavos or v_lancamento.descricao is distinct from v_descricao then
      return jsonb_build_object('ok', false, 'reason', 'Esse lançamento já existe com outros dados.');
    end if;
    return jsonb_build_object('ok', true, 'saldo_centavos', v_antes);
  end if;

  update public.qf_carteiras
    set saldo_centavos = saldo_centavos + p_valor_centavos, atualizado_em = now()
    where profissional_id = p_user_id returning saldo_centavos into v_depois;

  insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (p_user_id, 'credito', p_valor_centavos, 'admin', p_operacao_id, v_descricao);

  perform private.qf_log_pagamento(p_operacao_id, p_user_id, 'ajuste_manual',
    jsonb_build_object('admin_id', v_admin, 'valor_centavos', p_valor_centavos, 'saldo_antes_centavos', v_antes,
      'saldo_depois_centavos', v_depois, 'descricao', v_descricao), 'qf_carteiras');
  return jsonb_build_object('ok', true, 'saldo_centavos', v_depois);
end;
$$;

revoke all on function public.qf_admin_creditar_carteira(uuid, integer, text, uuid) from public, anon;
grant execute on function public.qf_admin_creditar_carteira(uuid, integer, text, uuid) to authenticated;
