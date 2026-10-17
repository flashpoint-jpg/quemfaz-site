-- Teste de integração do Radar de Leads Externos (banco).
-- Roda tudo dentro de uma transação que SEMPRE termina em erro proposital (RAISE EXCEPTION),
-- portanto nada é gravado de verdade. Os dados são FICTÍCIOS (domínio .invalid) e identificados.
-- Triggers de usuário ficam desligados (session_replication_role = replica) para que o pedido,
-- o desbloqueio e a recarga de teste não disparem notificações, cascata nem cobrança.
-- O resultado vem na mensagem do erro: "RADAR_TESTE_OK|{...}" ou "RADAR_TESTE_FALHOU|...".
do $t$
declare
  v_admin uuid; v_outro uuid := gen_random_uuid();
  v_cliente uuid; v_cat text; v_pro uuid; v_chamado uuid := gen_random_uuid();
  r jsonb := '{}'::jsonb; x jsonb; v_lead uuid; v_token text; v_link text;
  b_ch int; b_push int; b_mov int; b_desb int; b_rec int;
  a_ch int; a_push int; a_mov int; a_desb int; a_rec int;
  v_err text; v_state text;
begin
  select user_id into v_admin from public.qf_admins limit 1;
  select cliente_id, categoria into v_cliente, v_cat from public.qf_chamados limit 1;
  select profissional_id into v_pro from public.qf_desbloqueios limit 1;
  if v_admin is null or v_cliente is null or v_pro is null then raise exception 'dados base ausentes'; end if;

  execute 'set local session_replication_role = replica';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  -- fonte de teste habilitada (exige prova de autorização por constraint)
  insert into public.qf_lead_sources (id, label, kind, enabled, authorization_note, allowed_host)
  values ('teste_fonte', 'Fonte de teste', 'rss', true, 'Fonte fictícia usada apenas neste teste automatizado.', 'forum.teste.invalid');

  select count(*) into b_ch from public.qf_chamados;
  select count(*) into b_push from public.qf_push_entregas;
  select count(*) into b_mov from public.qf_movimentacoes_carteira;
  select count(*) into b_desb from public.qf_desbloqueios;
  select count(*) into b_rec from public.qf_recargas;

  -- 1. ingestão: demanda válida (com telefone e e-mail no texto), oferta, host errado, duplicado de conteúdo, baixa confiança
  x := public.qf_radar_ingest(jsonb_build_array(
    jsonb_build_object('source','teste_fonte','source_url','https://forum.teste.invalid/p/1','intent','procura_profissional',
      'service','pintor','service_slug','pintor','city','Santo André','neighborhood','Jardim','urgency','urgente','confidence',0.9,
      'excerpt','TESTE FICTICIO: Preciso de pintor em Santo André, falar com (11) 91234-5678 ou teste@exemplo.invalid'),
    jsonb_build_object('source','teste_fonte','source_url','https://forum.teste.invalid/p/2','intent','oferta_servico',
      'service','pintor','city','Santo André','excerpt','TESTE FICTICIO: sou pintor, ofereço serviços'),
    jsonb_build_object('source','teste_fonte','source_url','https://outro.teste.invalid/p/3','intent','procura_profissional',
      'service','pintor','city','Mauá','confidence',0.9,'excerpt','TESTE FICTICIO host nao aprovado'),
    jsonb_build_object('source','teste_fonte','source_url','https://forum.teste.invalid/p/4','intent','procura_profissional',
      'service','pintor','service_slug','pintor','city','Santo André','confidence',0.9,
      'excerpt','TESTE FICTICIO: Preciso de pintor em Santo André, falar com (11) 91234-5678 ou teste@exemplo.invalid'),
    jsonb_build_object('source','teste_fonte','source_url','https://forum.teste.invalid/p/5','intent','procura_profissional',
      'service','eletricista','service_slug','eletricista','city','Diadema','confidence',0.5,
      'excerpt','TESTE FICTICIO: alguém conhece eletricista em Diadema?'),
    jsonb_build_object('source','fonte_inexistente','source_url','https://forum.teste.invalid/p/6','intent','procura_profissional',
      'service','pintor','city','Mauá','confidence',0.9,'excerpt','TESTE FICTICIO fonte nao cadastrada')));
  r := r || jsonb_build_object('ingestao_1', x);
  if (x->>'novos')::int <> 2 or (x->>'ofertas_descartadas')::int <> 1 or (x->>'duplicados')::int <> 1 or (x->>'rejeitados')::int <> 2 then
    raise exception 'ingestao inesperada: %', x;
  end if;

  -- 2. idempotência: repetir o mesmo lote não cria nada novo
  x := public.qf_radar_ingest(jsonb_build_array(
    jsonb_build_object('source','teste_fonte','source_url','https://forum.teste.invalid/p/1','intent','procura_profissional',
      'service','pintor','service_slug','pintor','city','Santo André','confidence',0.9,
      'excerpt','TESTE FICTICIO: Preciso de pintor em Santo André, falar com (11) 91234-5678 ou teste@exemplo.invalid')));
  r := r || jsonb_build_object('ingestao_2', x);
  if (x->>'repetidos')::int <> 1 or (x->>'novos')::int <> 0 then raise exception 'idempotencia falhou: %', x; end if;

  -- 3. dados pessoais removidos do trecho e status conforme a confiança
  select id into v_lead from public.qf_leads_externos where source_url = 'https://forum.teste.invalid/p/1';
  if exists (select 1 from public.qf_leads_externos where source_url like 'https://forum.teste.invalid/p/%'
             and (excerpt ~ '91234' or excerpt ~ '@exemplo')) then raise exception 'dado pessoal não removido'; end if;
  r := r || jsonb_build_object('status_alta_confianca', (select status from public.qf_leads_externos where id = v_lead),
    'status_baixa_confianca', (select status from public.qf_leads_externos where source_url = 'https://forum.teste.invalid/p/5'),
    'status_duplicado', (select status from public.qf_leads_externos where source_url = 'https://forum.teste.invalid/p/4'));

  -- 4. lead não confirmado não gera notificação, pedido, desbloqueio, movimentação nem recarga
  select count(*) into a_ch from public.qf_chamados;
  select count(*) into a_push from public.qf_push_entregas;
  select count(*) into a_mov from public.qf_movimentacoes_carteira;
  select count(*) into a_desb from public.qf_desbloqueios;
  select count(*) into a_rec from public.qf_recargas;
  if (a_ch, a_push, a_mov, a_desb, a_rec) is distinct from (b_ch, b_push, b_mov, b_desb, b_rec) then
    raise exception 'lead em staging alterou pedidos/push/carteira';
  end if;
  r := r || jsonb_build_object('lead_nao_confirmado_sem_efeitos', true);

  -- 5. convite: preparar (não envia), marcar enviado, link rastreável
  x := public.qf_radar_preparar_convite(v_lead, 'manual');
  v_token := x->>'token'; v_link := x->>'link';
  if v_link not like 'https://quemfazservico.com.br/?servico=pintor&utm_source=radar&utm_medium=convite&utm_campaign=radar_abc_pintor&utm_content=%' then
    raise exception 'link inesperado: %', v_link;
  end if;
  perform public.qf_radar_marcar_convite_enviado(v_lead, 'manual', 'teste');
  r := r || jsonb_build_object('link', v_link);

  -- 6. cliente publica pelo link: o pedido entra pelo fluxo normal (aqui simulado com a mesma origem gravada pelo formulário)
  insert into public.qf_chamados (id, cliente_id, categoria, titulo, descricao, cidade, uf, status, marketing_origem)
  values (v_chamado, v_cliente, v_cat, 'TESTE FICTICIO radar', 'TESTE FICTICIO radar', 'Santo André', 'SP', 'aberto',
          jsonb_build_object('source','radar','medium','convite','campaign','radar_abc_pintor','content', v_token));
  x := public.qf_radar_resumo();
  if (x->>'pedidos_publicados')::int <> 1 or (x->>'clientes_confirmados')::int <> 1 or (x->>'convites_enviados')::int <> 1 then
    raise exception 'vinculo ao pedido falhou: %', x;
  end if;
  if (select status from public.qf_leads_externos where id = v_lead) <> 'pedido_publicado' then raise exception 'status final inesperado'; end if;

  -- 7. desbloqueio e recarga posteriores são atribuídos ao radar
  insert into public.qf_desbloqueios (chamado_id, profissional_id, valor_centavos, origem, ativo)
  values (v_chamado, v_pro, 490, 'saldo', true);
  insert into public.qf_recargas (profissional_id, valor_centavos, metodo, status, provedor, aprovado_em)
  values (v_pro, 2000, 'pix', 'aprovado', 'teste', now() + interval '1 minute');
  x := public.qf_radar_resumo();
  r := r || jsonb_build_object('resumo', x);
  if (x->>'desbloqueios')::int <> 1 or (x->>'creditos_centavos')::int <> 490 or (x->>'profissionais_desbloquearam')::int <> 1
     or (x->>'recargas_atribuiveis')::int <> 1 or (x->>'recargas_atribuiveis_centavos')::int <> 2000 then
    raise exception 'metricas de desbloqueio/recarga inesperadas: %', x;
  end if;

  -- 8. histórico do lead
  r := r || jsonb_build_object('eventos', (select jsonb_agg(e->>'tipo') from jsonb_array_elements(public.qf_radar_eventos(v_lead)) e));

  -- 9. LGPD: excluir remove lead e histórico, grava só o hash e impede recaptura
  -- (triggers voltam ao normal: as chaves estrangeiras em cascata também são triggers do sistema)
  execute 'set local session_replication_role = origin';
  perform public.qf_radar_excluir(v_lead, 'exclusao_lgpd');
  if exists (select 1 from public.qf_leads_externos where id = v_lead) or exists (select 1 from public.qf_lead_events where lead_id = v_lead) then
    raise exception 'exclusao nao removeu lead/eventos';
  end if;
  x := public.qf_radar_ingest(jsonb_build_array(
    jsonb_build_object('source','teste_fonte','source_url','https://forum.teste.invalid/p/1','intent','procura_profissional',
      'service','pintor','city','Santo André','confidence',0.9,'excerpt','TESTE FICTICIO recaptura')));
  if (x->>'suprimidos')::int <> 1 then raise exception 'supressao falhou: %', x; end if;
  r := r || jsonb_build_object('recaptura_bloqueada', true);

  -- 10. retenção: lead vencido sem pedido é removido pela manutenção
  update public.qf_leads_externos set expires_at = now() - interval '1 day' where source_url = 'https://forum.teste.invalid/p/5';
  r := r || jsonb_build_object('manutencao', private.qf_radar_manutencao());
  if exists (select 1 from public.qf_leads_externos where source_url = 'https://forum.teste.invalid/p/5') then
    raise exception 'retencao nao removeu lead vencido';
  end if;

  -- 11. acesso: não-admin, anon e acesso direto às tabelas são negados
  perform set_config('request.jwt.claims', json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_outro::text, true);
  begin
    perform public.qf_radar_resumo();
    raise exception 'nao-admin conseguiu ler o resumo';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then raise exception 'esperava 42501 e veio % (%)', v_state, sqlerrm; end if;
  end;
  r := r || jsonb_build_object('nao_admin_negado', true);

  execute 'set local role authenticated';
  begin
    perform 1 from public.qf_leads_externos limit 1;
    raise exception 'authenticated leu a tabela direto';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.qf_radar_ingest('[]'::jsonb);
    raise exception 'authenticated executou ingestao';
  exception when insufficient_privilege then null;
  end;
  execute 'set local role anon';
  begin
    perform public.qf_radar_resumo();
    raise exception 'anon executou resumo';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  r := r || jsonb_build_object('acesso_direto_e_anon_negados', true);

  raise exception 'RADAR_TESTE_OK|%', r::text;
end
$t$;
