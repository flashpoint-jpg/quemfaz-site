-- Asserções do banco para pedidos com valor definido, taxa, baixa por QR, cancelamento e contestação.
-- Ordem de execução: fixtures/valor-definido-schema.sql -> supabase/2026-10-18-pedidos-valor-definido-qr.sql -> este arquivo.
-- Qualquer falha de assert interrompe a execução.
create or replace function public.t_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function public.t_as(n integer) returns void language sql as $$ select set_config('request.jwt.claim.sub', public.t_uid(n)::text, false) $$;
create or replace function public.t_admin(b boolean) returns void language sql as $$ select set_config('test.admin', case when b then 'true' else 'false' end, false) $$;

-- Pessoas: 1 e 2 = clientes; 11..13 = profissionais próximos; 14 = longe; 15 = sem saldo.
insert into public.qf_profiles (id, tipo, nome, foto_url, telefone, whatsapp) values
  (public.t_uid(1), 'cliente', 'Cliente A', null, '11900000001', '11900000001'),
  (public.t_uid(2), 'cliente', 'Cliente B', null, '11900000002', '11900000002'),
  (public.t_uid(11), 'profissional', 'Pro Um', 'https://x/1.jpg', null, null),
  (public.t_uid(12), 'profissional', 'Pro Dois', 'https://x/2.jpg', null, null),
  (public.t_uid(13), 'profissional', 'Pro Tres', 'https://x/3.jpg', null, null),
  (public.t_uid(14), 'profissional', 'Pro Longe', 'https://x/4.jpg', null, null),
  (public.t_uid(15), 'profissional', 'Pro Sem Saldo', 'https://x/5.jpg', null, null);
insert into public.qf_profissionais (user_id, especialidades, raio_km, latitude, longitude) values
  (public.t_uid(11), array['pintor'], 20, -23.55, -46.63), (public.t_uid(12), array['pintor'], 20, -23.55, -46.63),
  (public.t_uid(13), array['pintor','eletricista'], 20, -23.55, -46.63), (public.t_uid(14), array['pintor'], 20, -22.0, -45.0),
  (public.t_uid(15), array['pintor'], 20, -23.55, -46.63);
insert into public.qf_carteiras (profissional_id, saldo_centavos, bonus_inicial_usado) values
  (public.t_uid(11), 20000, true), (public.t_uid(12), 20000, true), (public.t_uid(13), 20000, true), (public.t_uid(14), 20000, true), (public.t_uid(15), 0, true);
insert into public.qf_precos_desbloqueio (categoria, preco_centavos) values ('padrao', 790);
insert into public.qf_carteirinhas (profissional_id) values (public.t_uid(11)), (public.t_uid(12));

-- T1) Com a chave DESLIGADA nada de valor definido entra; pedido tradicional segue igual e ignora campos de valor.
do $$ declare r public.qf_chamados; begin
  assert (public.qf_pedidos_valor_config()->>'ativo')::boolean = false, 'chave deve nascer desligada';
  begin
    insert into public.qf_chamados (cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
    values (public.t_uid(1), 'pintor', 'pintar sala', 'valor_definido', 150000, true, now(), -23.55, -46.63);
    raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'valor_definido_desativado', 'T1 recusa com chave desligada: ' || sqlerrm; end;
  insert into public.qf_chamados (cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, max_orcamentos, latitude, longitude)
  values (public.t_uid(1), 'pintor', 'tradicional', 'contatos', 99999, true, 4, -23.55, -46.63) returning * into r;
  assert r.modalidade = 'contatos' and r.valor_oferecido_centavos is null and r.material_incluso is null and r.max_orcamentos = 4, 'T1 tradicional normalizado';
end $$;

-- T2) Admin liga a chave; não-admin não consegue.
do $$ begin
  perform public.t_admin(false);
  begin perform public.qf_admin_pedidos_valor_ativar(true); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'admin authentication required', 'T2 só admin: ' || sqlerrm; end;
  perform public.t_admin(true);
  assert (public.qf_admin_pedidos_valor_ativar(true)->>'ativo')::boolean, 'T2 ativar';
  assert (public.qf_pedidos_valor_config()->>'ativo')::boolean, 'T2 config ativa';
  perform public.t_admin(false);
end $$;

-- T3) Validação do valor, material e confirmação; servidor fixa 1 profissional e a hora.
do $$ declare r public.qf_chamados; msg text; begin
  perform public.t_as(1);
  for msg in select unnest(array['valor_invalido|null|true', 'valor_invalido|1999|true', 'valor_invalido|50000001|true', 'material_obrigatorio|150000|null', 'confirmacao_obrigatoria|150000|true|sem']) loop
    begin
      insert into public.qf_chamados (cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
      values (public.t_uid(1), 'pintor', 'x', 'valor_definido',
              nullif(split_part(msg, '|', 2), 'null')::integer, nullif(split_part(msg, '|', 3), 'null')::boolean,
              case when split_part(msg, '|', 4) = 'sem' then null else now() end, -23.55, -46.63);
      raise exception 'deveria recusar %', msg;
    exception when others then assert sqlerrm = split_part(msg, '|', 1), 'T3 ' || msg || ' -> ' || sqlerrm; end;
  end loop;
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, max_orcamentos, latitude, longitude)
  values ('00000000-0000-4000-8000-0000000000a1', public.t_uid(1), 'pintor', 'pintar sala 20m2', 'valor_definido', 150000, true, now() - interval '3 days', 4, -23.55, -46.63) returning * into r;
  assert r.max_orcamentos = 1, 'T3 só 1 profissional';
  assert r.valor_confirmado_em > now() - interval '1 minute', 'T3 hora do servidor, não a do aparelho';
  assert r.status = 'aberto', 'T3 status aberto';
end $$;

-- T4) Taxa: 6% inicial, arredondamento, teto por profissão e profissão nova cai no padrão.
do $$ begin
  assert public.qf_taxa_indicacao_centavos('pintor', 150000) = 9000, 'T4 R$1.500 -> R$90';
  assert public.qf_taxa_indicacao_centavos('pintor', 3333) = 200, 'T4 arredondamento';
  assert public.qf_taxa_indicacao_centavos('profissao_criada_amanha', 100000) = 6000, 'T4 profissão nova usa o padrão';
  perform public.t_admin(true);
  assert (public.qf_admin_salvar_taxa_indicacao('eletricista', 600, 5000, true)->>'ok')::boolean, 'T4 salvar teto';
  perform public.t_admin(false);
  assert public.qf_taxa_indicacao_centavos('eletricista', 150000) = 5000, 'T4 teto aplicado';
  assert public.qf_taxa_indicacao_centavos('pintor', 150000) = 9000, 'T4 teto de uma profissão não afeta outra';
  assert public.qf_taxa_indicacao_centavos('pintor', 0) = 0 and public.qf_taxa_indicacao_centavos('pintor', null) = 0, 'T4 valor zero';
  begin perform public.qf_admin_salvar_taxa_indicacao('pintor', 600, null, true); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'admin authentication required', 'T4 só admin altera taxa'; end;
end $$;

-- T5) Desbloqueio: sem saldo não libera; com saldo debita a taxa exata, uma vez; só 1 profissional; sem atalho.
do $$ declare r jsonb; v_saldo bigint; begin
  perform public.t_as(15);
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1');
  assert r->>'reason' = 'saldo_insuficiente' and (r->>'taxa_centavos')::int = 9000 and (r->>'falta_centavos')::int = 9000, 'T5 sem saldo mostra taxa exata: ' || r::text;
  assert (select count(*) from public.qf_desbloqueios) = 0 and (select count(*) from public.qf_movimentacoes_carteira) = 0, 'T5 nada liberado nem cobrado';
  perform public.t_as(14);
  assert public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1')->>'reason' = 'nao_elegivel', 'T5 fora do raio';
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1', 8000);
  assert r->>'reason' = 'taxa_mudou' and (r->>'taxa_centavos')::int = 9000, 'T5 taxa confirmada diferente do servidor';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = 20000, 'T5 nada debitado em taxa_mudou';
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1', 9000);
  assert (r->>'ok')::boolean and (r->>'taxa_centavos')::int = 9000, 'T5 desbloqueio ok: ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = 11000, 'T5 débito exato de R$90';
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1');
  assert (r->>'already_unlocked')::boolean, 'T5 repetir não cobra de novo';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(11)) = 11000, 'T5 sem cobrança duplicada';
  assert (select count(*) from public.qf_movimentacoes_carteira where tipo = 'debito') = 1, 'T5 um único débito registrado';
  assert (select valor_centavos from public.qf_desbloqueios where profissional_id = public.t_uid(11)) = 9000 and (select status from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000a1') = 'em_negociacao', 'T5 registro e status';
  perform public.t_as(12);
  r := public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1');
  assert r->>'reason' = 'reservado', 'T5 segundo profissional barrado (limite 1): ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(12)) = 20000, 'T5 segundo não paga';
  assert (select count(*) from public.qf_pedido_eventos where tipo = 'desbloqueio_valor') = 1, 'T5 histórico registrado';
  -- cliente não desbloqueia o próprio pedido; modalidade tradicional não passa pela função nova
  perform public.t_as(1);
  begin perform public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1'); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'professional profile required', 'T5 cliente não é profissional'; end;
end $$;

-- T6) A função TRADICIONAL de produção não vira atalho para pedido de valor definido; e segue igual no tradicional.
do $$ declare v_trad uuid; r jsonb; c6 uuid := '00000000-0000-4000-8000-0000000000f6'; begin
  perform public.t_as(2);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values (c6, public.t_uid(2), 'pintor', 'pintar cozinha', 'valor_definido', 90000, true, now(), -23.55, -46.63);
  perform public.t_as(13);
  begin perform public.qf_desbloquear_chamado(c6); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'desbloqueio_valor_definido_requer_taxa', 'T6 atalho barrado: ' || sqlerrm; end;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(13)) = 20000, 'T6 nada debitado (a transação inteira desfeita)';
  assert (select count(*) from public.qf_desbloqueios where chamado_id = c6) = 0, 'T6 nenhum desbloqueio gravado';
  select id into v_trad from public.qf_chamados where modalidade = 'contatos' limit 1;
  r := public.qf_desbloquear_chamado(v_trad);
  assert (r->>'ok')::boolean and (r->>'preco_centavos')::int = 790, 'T6 preço tradicional preservado: ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(13)) = 19210, 'T6 débito tradicional R$7,90';
  r := public.qf_desbloquear_chamado_valor(v_trad);
  assert r->>'reason' = 'modalidade_invalida', 'T6 função nova recusa pedido tradicional';
end $$;

-- T7) Informações do pedido: só quem pode ver; nenhum dado pessoal.
do $$ declare n integer; begin
  perform public.t_as(15);
  assert (select count(*) from public.qf_valor_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 1, 'T7 elegível vê';
  perform public.t_as(14);
  assert (select count(*) from public.qf_valor_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 1, 'T7 profissional fora do raio vê só valor/taxa (e continua sem poder desbloquear: ver T5)';
  perform public.t_as(2);
  assert (select count(*) from public.qf_valor_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 0, 'T7 outro cliente não vê';
  perform public.t_as(1);
  assert (select count(*) from public.qf_valor_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 1, 'T7 dono vê';
  assert (select rotulo from public.qf_valor_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 'Valor confirmado pelo cliente', 'T7 rótulo';
  assert (select count(*) from information_schema.columns where table_name = 'qf_valor_info_chamados' and column_name in ('telefone', 'whatsapp', 'cliente_id')) = 0, 'T7 sem dado pessoal';
  perform public.t_as(11);
  assert (select vagas from public.qf_valor_info_chamados(array['00000000-0000-4000-8000-0000000000a1'::uuid])) = 0, 'T7 vagas zero após desbloqueio';
end $$;

-- T8) Pedido de valor definido é imutável depois de publicado.
do $$ declare m text; begin
  perform public.t_as(1);
  foreach m in array array['update public.qf_chamados set valor_oferecido_centavos = 1000 where id = ''00000000-0000-4000-8000-0000000000a1''',
                           'update public.qf_chamados set modalidade = ''contatos'' where id = ''00000000-0000-4000-8000-0000000000a1''',
                           'update public.qf_chamados set material_incluso = false where id = ''00000000-0000-4000-8000-0000000000a1''',
                           'update public.qf_chamados set modalidade = ''valor_definido'' where modalidade = ''contatos'''] loop
    begin execute m; raise exception 'deveria recusar'; exception when others then assert sqlerrm in ('pedido_valor_imutavel', 'qf_chamados_modalidade_check') or sqlerrm like '%modalidade_check%', 'T8 ' || m || ' -> ' || sqlerrm; end;
  end loop;
  update public.qf_chamados set descricao = 'pintar sala e quarto' where id = '00000000-0000-4000-8000-0000000000a1';
end $$;

-- T9) Baixa por QR: só o cliente dono confirma; token hasheado, uso único, expiração; avaliação genuína.
do $$ declare r jsonb; k public.qf_conclusoes; tok text; cid uuid; begin
  perform public.t_as(11);
  r := public.qf_solicitar_baixa('00000000-0000-4000-8000-0000000000a1');
  assert (r->>'ok')::boolean and length(r->>'token') = 64, 'T9 baixa solicitada: ' || r::text;
  tok := r->>'token'; cid := (r->>'conclusao_id')::uuid;
  select * into k from public.qf_conclusoes where id = cid;
  assert k.token_hash <> tok and length(k.token_hash) = 64, 'T9 só o hash fica no banco';
  -- profissional não confirma por ele nem se auto-avalia
  assert public.qf_conclusao_responder(cid, 'concluido', 5, 'ótimo', null, tok)->>'reason' = 'sem_permissao', 'T9 profissional não confirma';
  assert (select count(*) from public.qf_avaliacoes) = 0, 'T9 nenhuma avaliação criada pelo profissional';
  -- outro cliente e outro profissional não conseguem
  perform public.t_as(2);
  assert jsonb_array_length(public.qf_cliente_conclusoes_pendentes(null, (select token from public.qf_carteirinhas where profissional_id = public.t_uid(11)))->'itens') = 0, 'T9 outro cliente escaneando o QR não vê pedidos alheios';
  assert public.qf_conclusao_responder(cid, 'concluido', 5, null, null, tok)->>'reason' = 'sem_permissao', 'T9 terceiro com token roubado';
  assert jsonb_array_length(public.qf_cliente_conclusoes_pendentes(tok, null)->'itens') = 0, 'T9 terceiro não enxerga pendência';
  perform public.t_as(12);
  assert public.qf_conclusao_responder(cid, 'concluido', 5, null, null, tok)->>'reason' = 'sem_permissao', 'T9 outro profissional';
  -- cliente dono
  perform public.t_as(1);
  assert jsonb_array_length(public.qf_cliente_conclusoes_pendentes(tok, null)->'itens') = 1, 'T9 pendência pelo link';
  assert jsonb_array_length(public.qf_cliente_conclusoes_pendentes(null, (select token from public.qf_carteirinhas where profissional_id = public.t_uid(11)))->'itens') = 1, 'T9 pendência pelo QR da carteirinha do profissional certo';
  assert jsonb_array_length(public.qf_cliente_conclusoes_pendentes(null, (select token from public.qf_carteirinhas where profissional_id = public.t_uid(12)))->'itens') = 0, 'T9 QR de outro profissional não mostra a pendência';
  assert public.qf_conclusao_responder(cid, 'concluido', 5, 'ótimo', null, 'tokenerrado')->>'reason' = 'sem_permissao', 'T9 token errado';
  assert public.qf_conclusao_responder(cid, 'concluido', 0, null, null, tok)->>'reason' = 'nota_invalida', 'T9 nota 0';
  assert public.qf_conclusao_responder(cid, 'concluido', 6, null, null, tok)->>'reason' = 'nota_invalida', 'T9 nota 6';
  assert public.qf_conclusao_responder(cid, 'qualquer', 5, null, null, tok)->>'reason' = 'resposta_invalida', 'T9 resposta inválida';
  r := public.qf_conclusao_responder(cid, 'concluido', 4, 'serviço bom', null, tok);
  assert (r->>'ok')::boolean, 'T9 cliente confirma: ' || r::text;
  assert (select status from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000a1') = 'concluido', 'T9 pedido concluído';
  assert (select profissional_id from public.qf_avaliacoes) = public.t_uid(11) and (select nota from public.qf_avaliacoes) = 4 and (select autor_tipo from public.qf_avaliacoes) = 'cliente', 'T9 avaliação genuína do profissional certo';
  assert (select avaliacao_media from public.qf_profissionais where user_id = public.t_uid(11)) = 4.00 and (select total_avaliacoes from public.qf_profissionais where user_id = public.t_uid(11)) = 1, 'T9 média atualizada';
  assert public.qf_conclusao_responder(cid, 'concluido', 1, null, null, tok)->>'reason' = 'ja_respondida', 'T9 replay barrado';
  assert (select nota from public.qf_avaliacoes) = 4, 'T9 replay não altera a nota';
  assert (select count(*) from public.qf_pedido_eventos where tipo = 'baixa_solicitada') = 1 and (select count(*) from public.qf_pedido_eventos where tipo = 'conclusao_concluido') = 1, 'T9 histórico';
end $$;

-- T10) Com problema / não realizado / expirada / pedido próprio / sem desbloqueio.
do $$ declare r jsonb; cid uuid; tok text; c2 uuid := '00000000-0000-4000-8000-0000000000b2'; begin
  perform public.t_as(2);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values (c2, public.t_uid(2), 'pintor', 'pintar muro', 'valor_definido', 30000, false, now(), -23.55, -46.63);
  perform public.t_as(12);
  assert public.qf_solicitar_baixa(c2)->>'reason' = 'sem_desbloqueio', 'T10 sem desbloqueio não pede baixa';
  assert (public.qf_desbloquear_chamado_valor(c2)->>'ok')::boolean, 'T10 desbloqueia';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(12)) = 18200, 'T10 taxa 6% de R$300 = R$18';
  r := public.qf_solicitar_baixa(c2); cid := (r->>'conclusao_id')::uuid; tok := r->>'token';
  r := public.qf_solicitar_baixa(c2);
  assert (select count(*) from public.qf_conclusoes where chamado_id = c2 and status = 'pendente') = 1 and (select count(*) from public.qf_conclusoes where chamado_id = c2 and status = 'substituida') = 1, 'T10 só uma pendente; a anterior é substituída';
  perform public.t_as(2);
  assert public.qf_conclusao_responder(cid, 'nao_realizado', null, null, null, tok)->>'reason' = 'ja_respondida', 'T10 token antigo invalidado';
  cid := (r->>'conclusao_id')::uuid; tok := r->>'token';
  assert public.qf_conclusao_responder(cid, 'com_problema', null, null, '  ', tok)->>'reason' = 'problema_obrigatorio', 'T10 problema exige descrição';
  update public.qf_conclusoes set expira_em = now() - interval '1 minute' where id = cid;
  assert public.qf_conclusao_responder(cid, 'nao_realizado', null, null, null, tok)->>'reason' = 'expirada', 'T10 expirada';
  update public.qf_conclusoes set expira_em = now() + interval '1 day' where id = cid;
  r := public.qf_conclusao_responder(cid, 'com_problema', null, null, 'pintura ficou manchada', tok);
  assert (r->>'ok')::boolean and (select status from public.qf_conclusoes where id = cid) = 'com_problema', 'T10 com problema';
  assert (select count(*) from public.qf_avaliacoes) = 1, 'T10 sem avaliação inventada';
  assert (select status from public.qf_chamados where id = c2) = 'em_negociacao', 'T10 pedido segue em negociação';
  -- profissional não pede baixa em pedido onde também é o cliente
  perform public.t_as(11);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, status, latitude, longitude) values ('00000000-0000-4000-8000-0000000000c3', public.t_uid(11), 'pintor', 'meu', 'em_negociacao', -23.55, -46.63);
  insert into public.qf_desbloqueios (chamado_id, profissional_id, valor_centavos, origem, ativo) values ('00000000-0000-4000-8000-0000000000c3', public.t_uid(11), 790, 'saldo', true);
  assert public.qf_solicitar_baixa('00000000-0000-4000-8000-0000000000c3')->>'reason' = 'sem_permissao', 'T10 não se auto-confirma';
end $$;

-- T11) Encerramento administrativo: exige admin e evidências; não cria avaliação nem muda o pedido.
do $$ declare cid uuid; before_status text; begin
  select id into cid from public.qf_conclusoes where status = 'com_problema' limit 1;
  select status into before_status from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000b2';
  perform public.t_admin(false);
  begin perform public.qf_admin_encerrar_conclusao(cid, 'evidência longa o bastante'); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'admin authentication required', 'T11 só admin'; end;
  perform public.t_admin(true);
  assert public.qf_admin_encerrar_conclusao(cid, 'curto')->>'reason' = 'evidencias_obrigatorias', 'T11 evidências';
  assert (public.qf_admin_encerrar_conclusao(cid, 'Cliente confirmou por telefone; ligação anexada ao protocolo 123')->>'ok')::boolean, 'T11 encerra';
  assert (select count(*) from public.qf_avaliacoes) = 1, 'T11 nenhuma avaliação criada';
  assert (select status from public.qf_chamados where id = '00000000-0000-4000-8000-0000000000b2') = before_status, 'T11 pedido inalterado';
  assert (select status from public.qf_conclusoes where id = cid) = 'encerrada_admin', 'T11 status administrativo distinto';
  assert public.qf_admin_encerrar_conclusao(cid, 'Cliente confirmou por telefone de novo')->>'reason' = 'status_invalido', 'T11 não encerra duas vezes';
  perform public.t_admin(false);
end $$;

-- T12) Cancelamento por imprevisto: registra, avisa, identifica desbloqueio e NÃO devolve crédito sozinho.
do $$ declare r jsonb; c4 uuid := '00000000-0000-4000-8000-0000000000d4'; saldo_antes bigint; begin
  perform public.t_as(2);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values (c4, public.t_uid(2), 'pintor', 'pintar portão', 'valor_definido', 80000, true, now(), -23.55, -46.63);
  perform public.t_as(13);
  assert (public.qf_desbloquear_chamado_valor(c4)->>'ok')::boolean, 'T12 desbloqueio';
  select saldo_centavos into saldo_antes from public.qf_carteiras where profissional_id = public.t_uid(13);
  perform public.t_as(1);
  assert public.qf_cliente_cancelar_pedido(c4, 'imprevisto')->>'reason' = 'sem_permissao', 'T12 só o dono cancela';
  perform public.t_as(2);
  assert public.qf_cliente_cancelar_pedido(c4, 'motivo_x')->>'reason' = 'motivo_invalido', 'T12 motivo inválido';
  assert public.qf_cliente_cancelar_pedido(c4, 'outro', ' ')->>'reason' = 'detalhe_obrigatorio', 'T12 outro exige detalhe';
  r := public.qf_cliente_cancelar_pedido(c4, 'imprevisto');
  assert (r->>'ok')::boolean and (r->>'houve_desbloqueio')::boolean and (r->>'profissionais_avisados')::int = 1, 'T12 cancelado: ' || r::text;
  assert (select status from public.qf_chamados where id = c4) = 'cancelado', 'T12 status';
  assert (select motivo from public.qf_cancelamentos_pedido where chamado_id = c4) = 'imprevisto' and (select houve_desbloqueio from public.qf_cancelamentos_pedido where chamado_id = c4), 'T12 registro com motivo e desbloqueio';
  assert (select count(*) from public.qf_profissional_avisos where chamado_id = c4 and user_id = public.t_uid(13) and tipo = 'pedido_cancelado') = 1, 'T12 profissional avisado';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(13)) = saldo_antes, 'T12 crédito NÃO devolvido automaticamente (devolucao_lead ligado de propósito)';
  assert (select count(*) from public.qf_movimentacoes_carteira where tipo = 'estorno') = 0 and (select count(*) from public.qf_devolucoes_lead) = 0, 'T12 nenhum estorno automático';
  assert public.qf_cliente_cancelar_pedido(c4, 'imprevisto')->>'reason' = 'status_invalido', 'T12 não cancela duas vezes';
  assert (select count(*) from public.qf_pedido_eventos where chamado_id = c4 and tipo = 'cancelado_cliente') = 1, 'T12 histórico';
end $$;

-- T13) Contestação: prazo, dono, uma por desbloqueio; admin decide; estorno uma única vez e pelo valor exato.
do $$ declare c4 uuid := '00000000-0000-4000-8000-0000000000d4'; d uuid; t uuid; r jsonb; saldo bigint; begin
  select id into d from public.qf_desbloqueios where chamado_id = c4;
  perform public.t_as(12);
  assert public.qf_contestar_desbloqueio(d, 'contato_falso', 'o número não é do cliente')->>'reason' = 'sem_permissao', 'T13 só quem desbloqueou';
  perform public.t_as(13);
  assert public.qf_contestar_desbloqueio(d, 'motivo_x', 'descrição longa o bastante')->>'reason' = 'motivo_invalido', 'T13 motivo';
  assert public.qf_contestar_desbloqueio(d, 'contato_falso', 'curta')->>'reason' = 'descricao_obrigatoria', 'T13 descrição';
  r := public.qf_contestar_desbloqueio(d, 'contato_falso', 'O número informado não existe, já tentei 3 vezes.', 'print da chamada');
  assert (r->>'ok')::boolean, 'T13 abre'; t := (r->>'contestacao_id')::uuid;
  assert public.qf_contestar_desbloqueio(d, 'contato_falso', 'O número informado não existe, já tentei 3 vezes.')->>'reason' = 'ja_contestado', 'T13 uma por desbloqueio';
  select saldo_centavos into saldo from public.qf_carteiras where profissional_id = public.t_uid(13);
  assert (select count(*) from public.qf_movimentacoes_carteira where tipo = 'estorno') = 0, 'T13 sem estorno antes da análise';
  perform public.t_admin(false);
  begin perform public.qf_admin_resolver_contestacao(t, 'estornar', 'analisado e aceito'); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'admin authentication required', 'T13 só admin decide'; end;
  perform public.t_admin(true);
  assert public.qf_admin_resolver_contestacao(t, 'talvez', 'analisado e aceito')->>'reason' = 'decisao_invalida', 'T13 decisão inválida';
  assert public.qf_admin_resolver_contestacao(t, 'estornar', 'x')->>'reason' = 'nota_obrigatoria', 'T13 nota obrigatória';
  r := public.qf_admin_resolver_contestacao(t, 'estornar', 'Provas conferem: contato inválido comprovado.');
  assert (r->>'ok')::boolean and (r->>'valor_estornado_centavos')::int = 4800, 'T13 estorno exato (6% de R$800 = R$48): ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(13)) = saldo + 4800, 'T13 saldo creditado';
  assert public.qf_admin_resolver_contestacao(t, 'estornar', 'Provas conferem: contato inválido comprovado.')->>'reason' = 'ja_decidida', 'T13 sem estorno duplo';
  assert (select count(*) from public.qf_movimentacoes_carteira where tipo = 'estorno') = 1, 'T13 um único estorno';
  assert (select ativo from public.qf_desbloqueios where id = d) = false, 'T13 desbloqueio encerrado';
  perform public.t_admin(false);
  perform public.t_as(13);
  assert public.qf_desbloquear_chamado_valor(c4)->>'reason' = 'ja_participou', 'T13 quem teve o desbloqueio encerrado não repete';
end $$;

-- T14) Contestação negada não devolve nada; reabre o pedido quando devolvido e sem outro profissional ativo.
do $$ declare c5 uuid := '00000000-0000-4000-8000-0000000000e5'; d uuid; t uuid; r jsonb; saldo bigint; begin
  perform public.t_as(2);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values (c5, public.t_uid(2), 'pintor', 'pintar teto', 'valor_definido', 60000, true, now(), -23.55, -46.63);
  perform public.t_as(15);
  update public.qf_carteiras set saldo_centavos = 10000 where profissional_id = public.t_uid(15);
  assert (public.qf_desbloquear_chamado_valor(c5)->>'ok')::boolean, 'T14 desbloqueio';
  select id into d from public.qf_desbloqueios where chamado_id = c5;
  r := public.qf_contestar_desbloqueio(d, 'contato_invalido', 'WhatsApp não existe, mensagem não entregue.');
  t := (r->>'contestacao_id')::uuid; select saldo_centavos into saldo from public.qf_carteiras where profissional_id = public.t_uid(15);
  perform public.t_admin(true);
  r := public.qf_admin_resolver_contestacao(t, 'negar', 'Contato respondeu no chat do app.');
  assert r->>'status' = 'negada' and (r->>'valor_estornado_centavos')::int = 0, 'T14 negada';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(15)) = saldo, 'T14 saldo igual';
  assert (select ativo from public.qf_desbloqueios where id = d), 'T14 desbloqueio mantido';
  perform public.t_admin(false);
end $$;

-- T14b) Estorno reabre o pedido: outro profissional pode pegar; quem recebeu o estorno não paga/volta duas vezes.
do $$ declare c7 uuid := '00000000-0000-4000-8000-0000000000f7'; d uuid; t uuid; r jsonb; begin
  perform public.t_as(2);
  insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
  values (c7, public.t_uid(2), 'pintor', 'pintar escada', 'valor_definido', 90000, true, now(), -23.55, -46.63);
  perform public.t_as(12);
  assert (public.qf_desbloquear_chamado_valor(c7)->>'ok')::boolean, 'T14b desbloqueio';
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(12)) = 12800, 'T14b débito de R$54';
  select id into d from public.qf_desbloqueios where chamado_id = c7;
  t := (public.qf_contestar_desbloqueio(d, 'contato_falso', 'Telefone pertence a outra pessoa que não conhece o pedido.')->>'contestacao_id')::uuid;
  perform public.t_admin(true);
  assert (public.qf_admin_resolver_contestacao(t, 'estornar', 'Titular do telefone confirmou que não pediu.')->>'ok')::boolean, 'T14b estorno';
  perform public.t_admin(false);
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(12)) = 18200, 'T14b saldo devolvido';
  assert (select status from public.qf_chamados where id = c7) = 'aberto', 'T14b pedido reaberto';
  r := public.qf_desbloquear_chamado_valor(c7);
  assert r->>'reason' = 'ja_participou', 'T14b quem teve estorno não volta ao mesmo pedido: ' || r::text;
  assert (select saldo_centavos from public.qf_carteiras where profissional_id = public.t_uid(12)) = 18200, 'T14b sem nova cobrança';
  perform public.t_as(11);
  r := public.qf_desbloquear_chamado_valor(c7);
  assert (r->>'ok')::boolean and (r->>'taxa_centavos')::int = 5400, 'T14b outro profissional assume: ' || r::text;
end $$;

-- T15) Cancelamentos repetitivos: só lista para revisão humana, nunca bloqueia.
do $$ declare i integer; c uuid; r jsonb; begin
  update public.qf_carteiras set saldo_centavos = 20000 where profissional_id = public.t_uid(11);
  perform public.t_as(2);
  for i in 1..2 loop
    c := gen_random_uuid();
    insert into public.qf_chamados (id, cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
    values (c, public.t_uid(2), 'pintor', 'repetido ' || i, 'valor_definido', 50000, true, now(), -23.55, -46.63);
    perform public.t_as(11); perform public.qf_desbloquear_chamado_valor(c); perform public.t_as(2);
    perform public.qf_cliente_cancelar_pedido(c, 'financeiro');
  end loop;
  perform public.t_admin(false);
  begin perform public.qf_admin_cancelamentos_suspeitos(30, 3); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'admin authentication required', 'T15 só admin'; end;
  perform public.t_admin(true);
  r := public.qf_admin_cancelamentos_suspeitos(30, 3);
  assert jsonb_array_length(r) = 1 and (r->0->>'cliente_id')::uuid = public.t_uid(2) and (r->0->>'com_desbloqueio')::int = 3, 'T15 cliente listado: ' || r::text;
  assert (select ativo from public.qf_profiles where id = public.t_uid(2)) is true, 'T15 nenhum bloqueio automático';
  assert jsonb_array_length(public.qf_admin_cancelamentos_suspeitos(30, 4)) = 0, 'T15 limite configurável';
  perform public.t_admin(false);
end $$;

-- T16) Painel administrativo: lista tradicionais e valor definido com tudo que o admin precisa.
do $$ declare r jsonb; x jsonb; begin
  perform public.t_admin(true);
  r := public.qf_admin_pedidos_valor(null, 100, 0);
  assert jsonb_array_length(r) >= 6, 'T16 lista todos';
  assert jsonb_array_length(public.qf_admin_pedidos_valor('contatos', 100, 0)) = 2 and jsonb_array_length(public.qf_admin_pedidos_valor('valor_definido', 100, 0)) >= 5, 'T16 filtro por modalidade';
  select e into x from jsonb_array_elements(r) e where e->>'id' = '00000000-0000-4000-8000-0000000000a1';
  assert (x->>'valor_oferecido_centavos')::int = 150000 and (x->'desbloqueios'->0->>'taxa_centavos')::int = 9000 and (x->'desbloqueios'->0->>'pagamento_confirmado')::boolean and x->'conclusao'->>'status' = 'concluido', 'T16 campos: ' || x::text;
  assert jsonb_array_length(public.qf_admin_pedido_historico('00000000-0000-4000-8000-0000000000a1')) >= 3, 'T16 histórico';
  perform public.t_admin(false);
  begin perform public.qf_admin_pedidos_valor(null, 10, 0); raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'admin authentication required', 'T16 só admin'; end;
end $$;

-- T17) Permissões: tabelas novas fechadas, funções só para logados, carteirinha v2 com profissão.
do $$ declare r jsonb; begin
  set local role authenticated;
  begin perform count(*) from public.qf_conclusoes; raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.qf_pedido_eventos; raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.qf_cancelamentos_pedido; raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.qf_contestacoes_desbloqueio; raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform count(*) from public.qf_taxas_indicacao; raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  begin perform public.qf_solicitar_baixa(gen_random_uuid()); raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform public.qf_desbloquear_chamado_valor(gen_random_uuid()); raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  begin perform public.qf_cliente_cancelar_pedido(gen_random_uuid(), 'outro', 'x'); raise exception 'deveria negar';
  exception when insufficient_privilege then null; end;
  assert (public.qf_pedidos_valor_config()->>'ativo')::boolean is not null, 'T17 flag legível sem login';
  reset role;
  r := public.qf_carteirinha_publica_v2((select token from public.qf_carteirinhas where profissional_id = public.t_uid(11)));
  assert (r->>'ok')::boolean and r->'especialidades' = '["pintor"]'::jsonb and r->>'numero' like 'QF-%', 'T17 carteirinha com profissão: ' || r::text;
  assert (public.qf_carteirinha_publica_v2(gen_random_uuid())->>'ok')::boolean = false, 'T17 token inválido';
end $$;

-- T18) Desligar a chave volta tudo ao normal sem apagar nada.
do $$ declare n_antes integer; begin
  select count(*) into n_antes from public.qf_chamados;
  perform public.t_admin(true);
  perform public.qf_admin_pedidos_valor_ativar(false);
  perform public.t_admin(false);
  perform public.t_as(1);
  begin
    insert into public.qf_chamados (cliente_id, categoria, descricao, modalidade, valor_oferecido_centavos, material_incluso, valor_confirmado_em, latitude, longitude)
    values (public.t_uid(1), 'pintor', 'x', 'valor_definido', 150000, true, now(), -23.55, -46.63);
    raise exception 'deveria recusar';
  exception when others then assert sqlerrm = 'valor_definido_desativado', 'T18 ' || sqlerrm; end;
  perform public.t_as(11);
  assert public.qf_desbloquear_chamado_valor('00000000-0000-4000-8000-0000000000a1')->>'reason' = 'desativado', 'T18 desbloqueio valor desativado';
  assert public.qf_solicitar_baixa('00000000-0000-4000-8000-0000000000a1')->>'reason' = 'desativado', 'T18 baixa desativada';
  assert (select count(*) from public.qf_chamados) = n_antes, 'T18 nada apagado';
end $$;

select 'TODOS OS TESTES DE BANCO PASSARAM' as resultado;
