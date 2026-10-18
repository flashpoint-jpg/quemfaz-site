-- Reversão de 2026-10-18-confirmacao-contato-24h.sql (preserva a tabela qf_confirmacoes_contato e seus dados).
drop function if exists public.qf_confirmar_contato(uuid, text);
drop function if exists public.qf_contatos_pendentes();
drop function if exists private.qf_contato_pendente(uuid);
-- Volta o guarda de desbloqueio à versão da primeira migração (sem a confirmação de contato).
create or replace function private.qf_desbloqueio_valor_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.qf_chamados c where c.id = new.chamado_id and c.modalidade = 'valor_definido')
     and coalesce(current_setting('qf.valor_unlock', true), '') <> '1'
     and not coalesce(private.qf_is_admin(), false) then
    raise exception 'desbloqueio_valor_definido_requer_taxa';
  end if;
  return new;
end $$;
-- Volta qf_desbloquear_chamado_valor à versão da primeira migração (sem a checagem de confirmação pendente).
create or replace function public.qf_desbloquear_chamado_valor(p_chamado_id uuid, p_taxa_confirmada_centavos integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_prof uuid := auth.uid();
  c public.qf_chamados%rowtype;
  v_pendencia uuid;
  v_taxa integer;
  v_saldo bigint;
  v_ativos integer;
  v_exist public.qf_desbloqueios%rowtype;
begin
  if v_prof is null then raise exception 'authentication required'; end if;
  if not exists (select 1 from public.qf_profissionais where user_id = v_prof) then
    raise exception 'professional profile required';
  end if;
  if not coalesce((private.qf_valor_cfg()->>'ativo')::boolean, false) then
    return jsonb_build_object('ok', false, 'reason', 'desativado');
  end if;

  v_pendencia := private.qf_pendencia_finalizacao(v_prof, 'profissional');
  if v_pendencia is not null then
    return jsonb_build_object('ok', false, 'reason', 'avaliacao_pendente', 'chamado_id', v_pendencia);
  end if;
  if not exists (select 1 from public.qf_profiles where id = v_prof and nullif(trim(coalesce(foto_url, '')), '') is not null) then
    return jsonb_build_object('ok', false, 'reason', 'selfie_obrigatoria');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('qf_valor_unlock:' || p_chamado_id::text || ':' || v_prof::text, 0));

  select * into c from public.qf_chamados where id = p_chamado_id for update;
  if not found then raise exception 'call not found'; end if;
  if c.modalidade <> 'valor_definido' then
    return jsonb_build_object('ok', false, 'reason', 'modalidade_invalida');
  end if;
  if c.cliente_id = v_prof then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;

  select * into v_exist from public.qf_desbloqueios where chamado_id = p_chamado_id and profissional_id = v_prof;
  if found then
    if coalesce(v_exist.ativo, true) then
      return jsonb_build_object('ok', true, 'already_unlocked', true,
        'taxa_centavos', coalesce(v_exist.valor_centavos, 0), 'valor_centavos', c.valor_oferecido_centavos);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'ja_participou');
  end if;

  if c.status not in ('aberto', 'em_negociacao') then return jsonb_build_object('ok', false, 'reason', 'indisponivel'); end if;

  select count(*)::integer into v_ativos from public.qf_desbloqueios d
   where d.chamado_id = p_chamado_id and coalesce(d.ativo, true);
  if v_ativos >= 1 then
    return jsonb_build_object('ok', false, 'reason', 'reservado', 'lotado', true, 'participantes', v_ativos, 'limite', 1);
  end if;

  if not exists (select 1 from public.qf_listar_chamados_disponiveis() d where d.id = p_chamado_id) then
    return jsonb_build_object('ok', false, 'reason', 'nao_elegivel');
  end if;

  v_taxa := public.qf_taxa_indicacao_centavos(c.categoria, c.valor_oferecido_centavos);
  if p_taxa_confirmada_centavos is not null and p_taxa_confirmada_centavos <> v_taxa then
    return jsonb_build_object('ok', false, 'reason', 'taxa_mudou', 'taxa_centavos', v_taxa,
                              'valor_centavos', c.valor_oferecido_centavos);
  end if;

  if v_taxa > 0 then
    insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_centavos, bonus_inicial_usado)
    values (v_prof, 0, 0, true) on conflict (profissional_id) do update set bonus_inicial_usado = true;
    perform private.qf_expirar_bonus_profissional(v_prof);
    select saldo_centavos into v_saldo from public.qf_carteiras where profissional_id = v_prof for update;
    if coalesce(v_saldo, 0) < v_taxa then
      return jsonb_build_object('ok', false, 'reason', 'saldo_insuficiente', 'taxa_centavos', v_taxa,
                                'saldo_centavos', coalesce(v_saldo, 0), 'falta_centavos', v_taxa - coalesce(v_saldo, 0),
                                'valor_centavos', c.valor_oferecido_centavos);
    end if;
    update public.qf_carteiras set saldo_centavos = saldo_centavos - v_taxa, atualizado_em = now()
     where profissional_id = v_prof;
    insert into public.qf_movimentacoes_carteira (profissional_id, tipo, valor_centavos, referencia_tipo, referencia_id, descricao)
    values (v_prof, 'debito', v_taxa, 'chamado', p_chamado_id, 'Taxa de indicação (pedido com valor definido)');
  else
    v_saldo := 0;
  end if;

  perform set_config('qf.valor_unlock', '1', true);
  insert into public.qf_desbloqueios (chamado_id, profissional_id, valor_centavos, origem, ativo, exclusivo)
  values (p_chamado_id, v_prof, v_taxa, 'saldo', true, false);
  perform set_config('qf.valor_unlock', '', true);

  update public.qf_chamados set status = 'em_negociacao', atualizado_em = now() where id = p_chamado_id;
  perform private.qf_push_interno('professional_connected', p_chamado_id);
  perform private.qf_evento(p_chamado_id, 'desbloqueio_valor', v_prof, 'profissional',
    jsonb_build_object('taxa_centavos', v_taxa, 'valor_oferecido_centavos', c.valor_oferecido_centavos));

  return jsonb_build_object('ok', true, 'taxa_centavos', v_taxa, 'valor_centavos', c.valor_oferecido_centavos,
                            'saldo_centavos', coalesce(v_saldo, 0) - v_taxa, 'participantes', 1, 'limite', 1);
end $$;
revoke all on function public.qf_desbloquear_chamado_valor(uuid, integer) from public, anon;
grant execute on function public.qf_desbloquear_chamado_valor(uuid, integer) to authenticated;
