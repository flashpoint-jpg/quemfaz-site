-- Confirmação de contato após 24 h. Roda depois de valor-definido-db.sql (usa os mesmos helpers e pessoas).
create or replace function public.t_envelhecer(p_chamado uuid, p_prof integer) returns void language sql as $$
  update public.qf_desbloqueios set criado_em = now() - interval '25 hours' where chamado_id = p_chamado and profissional_id = public.t_uid(p_prof) $$;

do $$ begin perform public.t_admin(true); perform public.qf_admin_pedidos_valor_ativar(true); perform public.t_admin(false); end $$;

-- C1) Antes de 24 h nada é pendente; depois de 24 h sem conversa, é.
do $$ declare r jsonb; begin
  perform public.t_as(1);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000f1', public.t_uid(1), 'pintor', 'pintar quarto', 'valor_definido', 100000, true, now(), -23.55, -46.63);
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000f1');
  assert (r->>'ok')::boolean, 'C1 desbloqueio inicial ' || r::text;
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C1 sem pendência antes de 24h';
  perform public.t_envelhecer('00000000-0000-4000-8000-0000000000f1', 11);
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 1, 'C1 pendente depois de 24h';
  assert (public.qf_contatos_pendentes()->0->>'chamado_id') = '00000000-0000-4000-8000-0000000000f1', 'C1 pedido certo';
  perform public.t_as(12);
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C1 pendência é só de quem desbloqueou';
end $$;

-- C2) Com confirmação pendente o profissional fica sem desbloquear novos pedidos (valor definido e tradicional).
do $$ declare r jsonb; begin
  perform public.t_as(1);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000f2', public.t_uid(1), 'pintor', 'pintar sala', 'valor_definido', 80000, false, now(), -23.55, -46.63);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000e9', public.t_uid(1), 'pintor', 'pintura tradicional', 4, -23.55, -46.63);
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000f2');
  assert r->>'reason' = 'confirmacao_pendente', 'C2 valor definido bloqueado: ' || r::text;
  begin
    perform public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000e9');
    raise exception 'deveria bloquear o tradicional';
  exception when others then assert sqlerrm = 'confirmacao_contato_pendente', 'C2 tradicional bloqueado: ' || sqlerrm; end;
  assert not exists (select 1 from public.qf_desbloqueios where chamado_id in ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e9') and profissional_id = public.t_uid(11)), 'C2 nada gravado';
  -- outro profissional, sem pendência, segue normal no tradicional
  perform public.t_as(12);
  assert (public.qf_desbloquear_chamado('00000000-0000-4000-8000-0000000000e9')->>'ok')::boolean, 'C2 outros não são afetados';
end $$;

-- C3) Cliente respondeu no chat: não há o que confirmar.
do $$ begin
  perform public.t_as(12);
  assert (public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000f2')->>'ok')::boolean, 'C3 pro 12 desbloqueia b2';
  insert into public.qf_chat_mensagens (chamado_id, profissional_id, remetente_id, tipo) values ('00000000-0000-4000-8000-0000000000f2', public.t_uid(12), public.t_uid(1), 'mensagem');
  perform public.t_envelhecer('00000000-0000-4000-8000-0000000000f2', 12);
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C3 cliente respondeu no chat, sem pendência';
end $$;

-- C4) "O cliente NÃO respondeu": libera o pedido, encerra o desbloqueio, sem devolução, e o profissional volta a poder desbloquear.
do $$ declare r jsonb; saldo_antes bigint; movs_antes integer; begin
  perform public.t_as(11);
  select saldo_centavos into saldo_antes from public.qf_carteiras where profissional_id = public.t_uid(11);
  select count(*) into movs_antes from public.qf_movimentacoes_carteira where profissional_id = public.t_uid(11);
  assert public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'qualquer')->>'reason' = 'resposta_invalida', 'C4 resposta inválida';
  r := public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'cliente_nao_respondeu');
  assert (r->>'ok')::boolean and (r->>'pedido_reaberto')::boolean, 'C4 ' || r::text;
  assert (select status from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000f1') = 'aberto', 'C4 pedido reaberto';
  assert not (select ativo from public.qf_desbloqueios where chamado_id = '00000000-0000-4000-8000-0000000000f1' and profissional_id = public.t_uid(11)), 'C4 desbloqueio encerrado';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = saldo_antes, 'C4 sem devolução automática';
  assert (select count(*) from public.qf_movimentacoes_carteira where profissional_id = public.t_uid(11)) = movs_antes, 'C4 nenhum lançamento novo';
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C4 pendência resolvida';
  assert public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'cliente_nao_respondeu')->>'reason' = 'sem_permissao', 'C4 não responde duas vezes';
  assert public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000f1')->>'reason' = 'ja_participou', 'C4 não desbloqueia o mesmo de novo';
  -- outro profissional agora consegue pegar o pedido liberado
  perform public.t_as(13);
  assert (public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000f1')->>'ok')::boolean, 'C4 vaga liberada para outro';
  -- evento registrado no histórico
  assert exists (select 1 from public.qf_pedido_eventos where chamado_id = '00000000-0000-4000-8000-0000000000f1' and tipo = 'contato_cliente_nao_respondeu'), 'C4 evento';
end $$;

-- C5) "O cliente respondeu": mantém o contato e o pedido; só quem desbloqueou pode confirmar.
do $$ declare r jsonb; begin
  perform public.t_envelhecer('00000000-0000-4000-8000-0000000000f1', 13);
  perform public.t_as(12);
  assert public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'cliente_respondeu')->>'reason' = 'sem_permissao', 'C5 terceiro não confirma por outro';
  perform public.t_as(1);
  assert public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'cliente_respondeu')->>'reason' = 'sem_permissao', 'C5 cliente não confirma pelo profissional';
  perform public.t_as(13);
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 1, 'C5 pro 13 pendente';
  r := public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'cliente_respondeu');
  assert (r->>'ok')::boolean and not (r->>'pedido_reaberto')::boolean, 'C5 ' || r::text;
  assert (select status from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000f1') = 'em_negociacao', 'C5 pedido continua';
  assert (select ativo from public.qf_desbloqueios where chamado_id = '00000000-0000-4000-8000-0000000000f1' and profissional_id = public.t_uid(13)), 'C5 desbloqueio mantido';
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C5 sem pendência';
  assert public.qf_confirmar_contato('00000000-0000-4000-8000-0000000000f1', 'cliente_nao_respondeu')->>'reason' = 'ja_respondida', 'C5 resposta única';
end $$;

-- C6) Baixa em andamento conta como resposta; chave desligada e anônimo não têm efeito.
do $$ begin
  perform public.t_as(1);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000f3', public.t_uid(1), 'pintor', 'pintar muro', 'valor_definido', 90000, true, now(), -23.55, -46.63);
  perform public.t_as(11);
  assert (public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000f3')->>'ok')::boolean, 'C6 desbloqueio';
  assert (public.qf_solicitar_baixa('00000000-0000-4000-8000-0000000000f3')->>'ok')::boolean, 'C6 baixa solicitada';
  perform public.t_envelhecer('00000000-0000-4000-8000-0000000000f3', 11);
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C6 baixa pendente = não precisa confirmar contato';
  -- chave desligada: nada pendente mesmo sem baixa/chat
  update public.qf_conclusoes set status = 'substituida' where chamado_id = '00000000-0000-4000-8000-0000000000f3';
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 1, 'C6 voltou a pendente';
  perform public.t_admin(true); perform public.qf_admin_pedidos_valor_ativar(false); perform public.t_admin(false);
  assert jsonb_array_length(public.qf_contatos_pendentes()) = 0, 'C6 chave desligada: sem pendência';
  perform public.t_admin(true); perform public.qf_admin_pedidos_valor_ativar(true); perform public.t_admin(false);
end $$;

do $$ begin
  set local role anon;
  begin perform public.qf_contatos_pendentes(); raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform public.qf_confirmar_contato(gen_random_uuid(), 'cliente_respondeu'); raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated;
  begin perform count(*) from public.qf_confirmacoes_contato; raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform * from private.qf_contato_pendente(public.t_uid(11)); raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

select 'CONFIRMACAO DE CONTATO: TODOS OS TESTES PASSARAM' as resultado;
