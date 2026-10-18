-- Reversão de supabase/2026-10-18-pedidos-valor-definido-qr.sql
-- Antes de rodar: exporte as tabelas novas (qf_conclusoes, qf_cancelamentos_pedido, qf_contestacoes_desbloqueio,
-- qf_pedido_eventos, qf_taxas_indicacao) — elas guardam histórico e NÃO são apagadas aqui.
-- Pedidos já criados com valor definido continuam existindo; por isso as colunas de qf_chamados também ficam.
-- Para só DESLIGAR tudo (caminho recomendado, sem mexer no banco):
--   update public.qf_config set valor = valor || '{"ativo": false}' where chave = 'pedidos_valor_definido';

drop trigger if exists qf_desbloqueio_valor_guard_before_insert on public.qf_desbloqueios;
drop trigger if exists qf_chamado_valor_guard_before_write on public.qf_chamados;
alter table public.qf_chamados drop constraint if exists qf_chamados_modalidade_check;

drop function if exists public.qf_desbloquear_chamado_valor(uuid, integer);
drop function if exists public.qf_valor_info_chamados(uuid[]);
drop function if exists public.qf_cliente_cancelar_pedido(uuid, text, text);
drop function if exists public.qf_solicitar_baixa(uuid);
drop function if exists public.qf_cliente_conclusoes_pendentes(text, uuid);
drop function if exists public.qf_conclusao_responder(uuid, text, integer, text, text, text);
drop function if exists public.qf_admin_encerrar_conclusao(uuid, text);
drop function if exists public.qf_contestar_desbloqueio(uuid, text, text, text);
drop function if exists public.qf_admin_resolver_contestacao(uuid, text, text);
drop function if exists public.qf_admin_pedidos_valor(text, integer, integer);
drop function if exists public.qf_admin_pedido_historico(uuid);
drop function if exists public.qf_admin_taxas_indicacao();
drop function if exists public.qf_admin_salvar_taxa_indicacao(text, integer, integer, boolean);
drop function if exists public.qf_admin_pedidos_valor_ativar(boolean);
drop function if exists public.qf_admin_cancelamentos_suspeitos(integer, integer);
drop function if exists public.qf_carteirinha_publica_v2(uuid);
drop function if exists public.qf_taxa_indicacao_centavos(text, integer);
drop function if exists public.qf_pedidos_valor_config();
drop function if exists private.qf_chamado_valor_guard();
drop function if exists private.qf_desbloqueio_valor_guard();
drop function if exists private.qf_evento(uuid, text, uuid, text, jsonb);
drop function if exists private.qf_valor_cfg();

-- Restaura qf_private.devolver_lead exatamente como estava em produção (sem a guarda de valor definido).
create or replace function qf_private.devolver_lead(p_desbloqueio_id uuid, p_motivo text)
returns integer language plpgsql security definer set search_path = '' as $function$
declare d public.qf_desbloqueios; v_id uuid; v_txt text; v_preco integer;
begin
  -- V11.21: devolução desligada pela chave devolucao_lead em qf_config.
  if not coalesce((select (c.valor->>'ativo')::boolean from public.qf_config c where c.chave = 'devolucao_lead'), true) then return 0; end if;
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
