-- QuemFaz — Confirmação de contato após 24 h (pedidos com valor definido).
-- Quem desbloqueou um pedido com valor definido e não conversou com o cliente precisa dizer, depois de 24 h,
-- se o cliente respondeu. Sem resposta, o profissional fica sem desbloquear NOVOS pedidos até responder.
-- Se disser que o cliente NÃO respondeu, o pedido é liberado para outro profissional (o desbloqueio dele é
-- encerrado, sem devolução automática; ele pode abrir contestação para análise humana).
-- Depende de supabase/2026-10-18-pedidos-valor-definido-qr.sql. Respeita a mesma chave (pedidos_valor_definido.ativo).
-- Reversão: supabase/2026-10-18-confirmacao-contato-24h-rollback.sql

create or replace function private.qf_valor_cfg()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ativo', false, 'percentual_bps', 600, 'valor_min_centavos', 2000,
                            'valor_max_centavos', 50000000, 'contestacao_dias', 15, 'conclusao_validade_dias', 7,
                            'confirmacao_horas', 24)
         || coalesce((select c.valor from public.qf_config c where c.chave = 'pedidos_valor_definido'), '{}'::jsonb);
$$;

create table if not exists public.qf_confirmacoes_contato (
  desbloqueio_id uuid primary key,
  chamado_id uuid not null,
  profissional_id uuid not null,
  resposta text not null check (resposta in ('cliente_respondeu', 'cliente_nao_respondeu')),
  respondida_em timestamptz not null default now()
);
create index if not exists qf_confirmacoes_contato_prof_idx on public.qf_confirmacoes_contato (profissional_id, respondida_em);
alter table public.qf_confirmacoes_contato enable row level security;
revoke all on public.qf_confirmacoes_contato from anon, authenticated;

-- Desbloqueios de valor definido que já passaram do prazo, sem conversa do cliente, sem confirmação e sem baixa em andamento.
create or replace function private.qf_contato_pendente(p_prof uuid)
returns table (desbloqueio_id uuid, chamado_id uuid, desbloqueado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.id, d.chamado_id, d.criado_em
    from public.qf_desbloqueios d
    join public.qf_chamados c on c.id = d.chamado_id
   where coalesce((private.qf_valor_cfg()->>'ativo')::boolean, false)
     and d.profissional_id = p_prof
     and coalesce(d.ativo, true)
     and c.modalidade = 'valor_definido'
     and c.status = 'em_negociacao'
     and d.criado_em < now() - make_interval(hours => (private.qf_valor_cfg()->>'confirmacao_horas')::integer)
     and not exists (select 1 from public.qf_confirmacoes_contato x where x.desbloqueio_id = d.id)
     and not exists (select 1 from public.qf_chat_mensagens m
                      where m.chamado_id = d.chamado_id and m.profissional_id = d.profissional_id
                        and m.remetente_id = c.cliente_id and m.tipo = 'mensagem' and m.criado_em >= d.criado_em)
     and not exists (select 1 from public.qf_conclusoes k
                      where k.desbloqueio_id = d.id and k.status in ('pendente', 'concluido'));
$$;
revoke all on function private.qf_contato_pendente(uuid) from public, anon, authenticated;

create or replace function public.qf_contatos_pendentes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('chamado_id', p.chamado_id, 'desbloqueado_em', p.desbloqueado_em,
                     'categoria', c.categoria, 'cidade', c.cidade, 'valor_oferecido_centavos', c.valor_oferecido_centavos)
                   order by p.desbloqueado_em)
                   from private.qf_contato_pendente(auth.uid()) p join public.qf_chamados c on c.id = p.chamado_id), '[]'::jsonb);
end $$;
revoke all on function public.qf_contatos_pendentes() from public, anon;
grant execute on function public.qf_contatos_pendentes() to authenticated;

create or replace function public.qf_confirmar_contato(p_chamado_id uuid, p_resposta text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); d public.qf_desbloqueios%rowtype; c public.qf_chamados%rowtype;
begin
  if v_uid is null then raise exception 'authentication required'; end if;
  if p_resposta is null or p_resposta not in ('cliente_respondeu', 'cliente_nao_respondeu') then
    return jsonb_build_object('ok', false, 'reason', 'resposta_invalida');
  end if;
  select * into c from public.qf_chamados where id = p_chamado_id for update;
  if not found or c.modalidade <> 'valor_definido' then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  select * into d from public.qf_desbloqueios where chamado_id = p_chamado_id and profissional_id = v_uid and coalesce(ativo, true) for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'sem_permissao'); end if;
  if exists (select 1 from public.qf_confirmacoes_contato where desbloqueio_id = d.id) then
    return jsonb_build_object('ok', false, 'reason', 'ja_respondida');
  end if;
  insert into public.qf_confirmacoes_contato (desbloqueio_id, chamado_id, profissional_id, resposta)
  values (d.id, p_chamado_id, v_uid, p_resposta);
  if p_resposta = 'cliente_nao_respondeu' then
    -- Libera a vaga: o contato deste profissional é encerrado e o pedido volta a ficar aberto para outro. Sem devolução automática.
    update public.qf_desbloqueios set ativo = false where id = d.id;
    update public.qf_chamados set status = 'aberto', atualizado_em = now() where id = p_chamado_id and status = 'em_negociacao';
  end if;
  perform private.qf_evento(p_chamado_id, 'contato_' || p_resposta, v_uid, 'profissional',
    jsonb_build_object('desbloqueio_id', d.id));
  return jsonb_build_object('ok', true, 'resposta', p_resposta, 'pedido_reaberto', p_resposta = 'cliente_nao_respondeu');
end $$;
revoke all on function public.qf_confirmar_contato(uuid, text) from public, anon;
grant execute on function public.qf_confirmar_contato(uuid, text) to authenticated;

-- Barreira: com confirmação pendente nenhum desbloqueio novo é gravado (vale para qualquer caminho, inclusive o tradicional).
create or replace function private.qf_desbloqueio_valor_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.qf_chamados c where c.id = new.chamado_id and c.modalidade = 'valor_definido')
     and coalesce(current_setting('qf.valor_unlock', true), '') <> '1'
     and not coalesce(private.qf_is_admin(), false) then
    raise exception 'desbloqueio_valor_definido_requer_taxa';
  end if;
  if not coalesce(private.qf_is_admin(), false) and exists (select 1 from private.qf_contato_pendente(new.profissional_id)) then
    raise exception 'confirmacao_contato_pendente';
  end if;
  return new;
end $$;

-- Mesma função de desbloqueio com valor definido, agora devolvendo 'confirmacao_pendente' com mensagem clara.
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

  -- Confirmação de contato (24 h): quem não respondeu se o cliente respondeu fica sem desbloquear novos pedidos.
  if exists (select 1 from private.qf_contato_pendente(v_prof)) then
    return jsonb_build_object('ok', false, 'reason', 'confirmacao_pendente');
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
