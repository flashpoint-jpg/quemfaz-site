// Devolução por erro (baixa na Entrada) e diagnóstico do push por pedido.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
const test = require('node:test');
const root = path.join(__dirname, '..');
const rd = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const sql = rd('supabase/migrations/20261018123000_admin_push_diagnostico_e_devolucao_erro.sql');
const admin = rd('admin.html'), sw = rd('sw.js');
const dev = rd('qf-admin-devolucao.js'), diag = rd('qf-admin-push-diagnostico.js');

test('banco: devolução vira estorno ligado ao pedido e é restrita ao administrador', () => {
  for (const fn of ['qf_admin_buscar_desbloqueios', 'qf_admin_devolver_desbloqueio', 'qf_admin_devolucoes_lista', 'qf_admin_push_diagnostico'])
    assert.ok(sql.includes('function public.' + fn), fn);
  assert.ok(/'estorno', d\.valor_centavos, 'chamado', d\.chamado_id/.test(sql), 'estorno referenciado ao chamado (a Entrada já desconta)');
  assert.ok(sql.includes('update public.qf_desbloqueios set ativo = false'), 'libera a vaga');
  assert.ok(/revoke all on function .*from public, anon/i.test(sql), 'sem acesso anônimo');
  for (const m of ['erro_cadastro_cliente', 'telefone_invalido', 'pedido_duplicado', 'outro_admin']) assert.ok(sql.includes(m), m);
});
test('painel: módulos carregados, cacheados e botão do diagnóstico presente', () => {
  assert.ok(admin.includes('qf-admin-devolucao.js?v=1') && admin.includes('qf-admin-push-diagnostico.js?v=1'));
  assert.ok(sw.includes('qf-admin-devolucao.js') && sw.includes('qf-admin-push-diagnostico.js'));
  assert.ok(admin.includes('data-push-diag='), 'botão Ver quem recebeu e por quê');
});
test('front: usa só as RPCs de administrador e não envia push nem mexe em pagamento', () => {
  assert.ok(dev.includes("'/admin/pagamentos'") && dev.includes('qf_admin_devolver_desbloqueio') && dev.includes('syncSnapshot'));
  assert.ok(diag.includes('qf_admin_push_diagnostico'));
  assert.ok(!/quemfaz-push|qf_admin_adicionar_creditos|functions\.invoke/.test(dev + diag));
});
test('front: renderização escapa HTML e traduz situações', () => {
  global.window = global;
  global.PU = { escapeHtml: (s) => String(s).replace(/</g, '&lt;'), formatCurrency: (c) => 'R$ ' + (c / 100).toFixed(2), formatDateTime: () => 'agora', toast() {}, openSheet() {}, closeSheet() {} };
  global.document = { addEventListener() {} };
  eval(dev); eval(diag);
  const card = QFAdminDevolucao.cartaoResultado({ titulo: '<b>x', codigo: 'ABC12345', devolvivel: true, valor_centavos: 1300, origem: 'carteira' }, 0);
  assert.ok(card.includes('data-dev-abrir="0"') && card.includes('&lt;b>x') && card.includes('R$ 13.00'));
  const bloq = QFAdminDevolucao.cartaoResultado({ titulo: 't', codigo: 'A', devolvivel: false, motivo_bloqueio: 'Já devolvido' }, 1);
  assert.ok(!bloq.includes('data-dev-abrir') && bloq.includes('Já devolvido'));
  const html = QFAdminPushDiagnostico.render({ pedido: { id: 'abcdef123', ocupadas: 1, limite: 4 }, resumo: { total_categoria: 2, elegiveis_agora: 1, por_situacao: { sem_token: 1, offline: 1 } }, itens: [{ nome: 'A', situacao: 'sem_token', km: 3.5 }, { nome: 'B', situacao: 'offline' }] });
  assert.ok(html.includes('Sem notificação ativada') && html.includes('Offline') && html.includes('ABCDEF12') && html.includes('3,5 km'));
});
