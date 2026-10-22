-- Indicação no painel admin + bônus de indicação depois do corte de 16/10/2026.
-- 1) Verificar um profissional não tenta mais dar o bônus de lançamento depois do corte
--    (antes o banco recusava e a verificação inteira falhava com "Concessoes de bonus encerradas").
-- 2) O bônus de INDICAÇÃO continua valendo depois do corte (os demais bônus seguem encerrados).
--    Ele não entra na validade de 10 dias (qf_bonus_prazo_nova_concessao só olha lançamento/massa/recarga).
-- 3) Ao pagar a indicação, o indicador recebe um push no celular.
-- 4) qf_admin_indicacoes(): só administrador; alimenta a etiqueta "Indicado por…" no painel.

create or replace function public.qf_admin_definir_verificado(p_user_id uuid, p_verificado boolean)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_bonus_concedido boolean := false;
  v_saldo bigint := 0;
  v_rows integer := 0;
begin
  if auth.uid() is null or not exists(select 1 from public.qf_admins where user_id = auth.uid()) then
    raise exception 'forbidden';
  end if;
  if not exists(select 1 from public.qf_profissionais where user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'profissional_nao_encontrado');
  end if;

  perform set_config('qf.admin_verificando', '1', true);
  update public.qf_profissionais
     set verificado = coalesce(p_verificado, false),
         verificacao_status = case when coalesce(p_verificado, false) then 'verificado' else 'pendente' end,
         verificacao_motivo = null,
         verificado_em = case when coalesce(p_verificado, false) then now() else null end,
         verificado_por = case when coalesce(p_verificado, false) then auth.uid() else null end,
         atualizado_em = now()
   where user_id = p_user_id;
  perform set_config('qf.admin_verificando', '', true);

  insert into public.qf_carteiras(profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (p_user_id, 0, 0, true)
  on conflict (profissional_id) do update set bonus_inicial_usado = true;

  -- Bônus de lançamento encerrado em 16/10/2026: depois do corte, só verifica (sem bônus).
  if coalesce(p_verificado, false) and now() < '2026-10-16 03:00:00+00'::timestamptz then
    insert into public.qf_movimentacoes_carteira(profissional_id, tipo, valor_centavos, referencia_tipo, descricao)
    values (p_user_id, 'bonus', 2500, 'bonus_lancamento', 'Bônus de lançamento QuemFaz — R$ 25,00')
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      update public.qf_carteiras set saldo_centavos = saldo_centavos + 2500, atualizado_em = now()
       where profissional_id = p_user_id;
      v_bonus_concedido := true;
    end if;
  end if;

  select saldo_centavos into v_saldo from public.qf_carteiras where profissional_id = p_user_id;
  return jsonb_build_object('ok', true, 'verificado', coalesce(p_verificado, false),
    'bonus_concedido', v_bonus_concedido, 'bonus_centavos', case when v_bonus_concedido then 2500 else 0 end,
    'saldo_centavos', coalesce(v_saldo, 0));
end;
$function$;

create or replace function private.qf_impedir_novos_bonus_apos_corte()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- Depois de 16/10/2026 nenhum bônus novo é concedido, EXCETO o bônus de indicação
  -- (pago a quem indicou quando o indicado é verificado).
  if now() >= '2026-10-16 03:00:00+00'::timestamptz
     and new.tipo = 'bonus'
     and coalesce(new.referencia_tipo, '') <> 'indicacao' then
    raise exception 'Concessoes de bonus encerradas em 16/10/2026'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

create or replace function private.qf_pagar_indicacao()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_ind record; v_bonus bigint; v_ativo boolean; v_rows int; v_seg text; v_nome text; v_valor text;
begin
  if not (new.verificado is true and coalesce(old.verificado, false) is false) then return new; end if;
  select * into v_ind from public.qf_indicacoes where indicado_id = new.user_id and status = 'pendente' for update;
  if not found then return new; end if;
  select coalesce((valor->>'bonus_centavos')::bigint, 0), coalesce((valor->>'ativo')::boolean, false)
    into v_bonus, v_ativo from public.qf_config where chave = 'indicacao';
  if not coalesce(v_ativo, false) or coalesce(v_bonus, 0) <= 0 then return new; end if;

  insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
  values (v_ind.indicador_id, 0, 0, true) on conflict (profissional_id) do nothing;

  insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
  values (v_ind.indicador_id, 'bonus', v_bonus, 'indicacao', new.user_id,
          'Bônus de indicação — profissional indicado foi verificado')
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    update public.qf_carteiras set saldo_centavos = saldo_centavos + v_bonus, atualizado_em = now()
     where profissional_id = v_ind.indicador_id;

    -- Avisa o indicador no celular. Se o aviso falhar, o pagamento do bônus continua valendo.
    begin
      select decrypted_secret into v_seg from vault.decrypted_secrets where name = 'qf_push_internal' limit 1;
      select split_part(btrim(coalesce(nome,'')), ' ', 1) into v_nome from public.qf_profiles where id = new.user_id;
      v_valor := 'R$ ' || replace(to_char(v_bonus / 100.0, 'FM999990.00'), '.', ',');
      perform net.http_post(
        url := 'https://dczlyrgnzlxmzghzaooz.supabase.co/functions/v1/quemfaz-admin-aviso',
        body := jsonb_build_object(
          'action', 'user_notice',
          'user_ids', jsonb_build_array(v_ind.indicador_id),
          'title', '🎉 Você ganhou um bônus de indicação!',
          'body', case when coalesce(v_nome,'') <> ''
                    then v_nome || ', que você indicou, foi verificado(a). ' || v_valor || ' já estão na sua carteira.'
                    else 'O profissional que você indicou foi verificado. ' || v_valor || ' já estão na sua carteira.' end,
          'url', '/',
          'tag', 'qf-bonus-indicacao'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-qf-internal', coalesce(v_seg, '')),
        timeout_milliseconds := 20000);
    exception when others then
      raise warning 'QuemFaz aviso bônus indicação: %', sqlerrm;
    end;
  end if;
  update public.qf_indicacoes set status = 'pago', bonus_centavos = v_bonus, pago_em = now() where indicado_id = new.user_id;
  return new;
exception when others then
  raise warning 'QuemFaz indicação: %', sqlerrm;
  return new;
end; $function$;

-- Indicações para o painel admin: quem indicou quem, se o bônus está pendente ou pago e quanto.
create or replace function public.qf_admin_indicacoes()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare v_bonus bigint; v_ativo boolean;
begin
  if not private.qf_is_admin() then raise exception 'forbidden'; end if;
  select coalesce((valor->>'bonus_centavos')::bigint, 0), coalesce((valor->>'ativo')::boolean, false)
    into v_bonus, v_ativo from public.qf_config where chave = 'indicacao';
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'indicado_id', i.indicado_id,
      'indicador_id', i.indicador_id,
      'indicador_nome', coalesce(nullif(btrim(pf.nome), ''), 'Profissional'),
      'status', i.status,
      'bonus_centavos', case when i.status = 'pago' then coalesce(i.bonus_centavos, 0)
                             when coalesce(v_ativo, false) then coalesce(v_bonus, 0) else 0 end,
      'criado_em', i.criado_em,
      'pago_em', i.pago_em)
      order by i.criado_em desc)
    from public.qf_indicacoes i
    left join public.qf_profiles pf on pf.id = i.indicador_id), '[]'::jsonb);
end;
$$;
revoke execute on function public.qf_admin_indicacoes() from public, anon;
grant execute on function public.qf_admin_indicacoes() to authenticated;
