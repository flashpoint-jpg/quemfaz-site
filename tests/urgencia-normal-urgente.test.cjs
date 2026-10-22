// Outubro/2026 — urgência do pedido: apenas Normal ou Urgente (as duas grátis), prioridade paga separada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const ext = fs.readFileSync(path.join(root, 'scripts', 'qf-other-jobs-extension.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-17-urgencia-normal-urgente.sql'), 'utf8');

function carregarModulo() {
  const a = html.indexOf('/* QuemFaz V11.29 — prazo do pedido');
  const b = html.indexOf('/* QuemFaz — dados do Supabase');
  const win = { PU: { escapeHtml: (v) => String(v) }, icon: () => '' };
  vm.runInNewContext(html.slice(html.indexOf('(function (global) {', a), b), { window: win, Date, Math, Number, String, Array });
  return win;
}

test('etiquetas do profissional: URGENTE vermelho, Normal discreto, prioridade paga separada', () => {
  const U = carregarModulo().QFUrgencia;
  assert.ok(U);
  assert.equal(U.ehUrgente({ urgencia: 'urgente' }), true);
  assert.equal(U.ehUrgente({ urgencia: 'normal', prioridade: true }), false);   // prioridade paga não vira Urgente
  assert.equal(U.ehUrgente({ urgencia: 'normal' }), false);
  assert.equal(U.ehUrgente({ urgencia: null }), false);                          // pedido antigo
  assert.equal(U.ehUrgente({ urgencia: null, prioridade: true }), true);         // antigo que pagou: segue com o selo vermelho de antes
  assert.match(U.tagHtml({ urgencia: 'urgente' }), /qf-urgente-tag[^>]*>URGENTE</);
  assert.match(U.tagHtml({ urgencia: 'normal' }), /qf-normal-tag[^>]*>Normal</);
  assert.match(U.tagHtml({}), />Normal</);
  assert.equal(U.prioridadeHtml({ prioridade: false }), '');
  assert.match(U.prioridadeHtml({ prioridade: true }), />PRIORITÁRIO</);
  assert.match(html, /\.qf-urgente-tag \{[^}]*background:#dc2626;[^}]*color:#fff/);
});

test('classificações antigas não aparecem para cliente nem profissional', () => {
  const P = carregarModulo().QFPrazo;
  ['hoje', 'amanha', 'semana', 'data', 'sem_pressa'].forEach((p) => assert.equal(P.info({ prazo: p, prazoDia: '2026-10-20' }, Date.now()), null));
  const telas = html.slice(0, html.indexOf('/* QuemFaz V11.29 — prazo do pedido')) ;
  assert.ok(!/>Sem pressa<|>Com pressa<|>Agendado</.test(html), 'texto visível das etiquetas antigas');
  assert.ok(!html.includes('Quando pretende executar o serviço'));
  assert.ok(!html.includes('Execução prevista'));
  assert.ok(telas.length > 0);
  assert.match(html, /function scheduleSummary\(req, paraCliente\) \{[\s\S]*?return '';\s*\}/);
});

test('pedido novo grava só a urgência e o pedido nunca se perde se o banco recusar', () => {
  assert.ok(html.includes("if (comUrgencia) row.urgencia = data.urgencia;"));
  assert.ok(html.includes("client.rpc('qf_publicar_atendimento'"));
  assert.ok(!html.includes("delete row.urgencia;"));
  assert.ok(html.includes("const prazoDados = { urgencia: urgenciaEscolhida };"));
  assert.ok(html.includes("urgencia: data.urgencia === 'urgente' ? 'urgente' : 'normal',"));
  // A prioridade paga continua sendo a única que cria cobrança.
  assert.ok(html.includes("status: data.prioridade ? 'aguardando_pagamento' : 'aberto',"));
  assert.ok(!/urgencia[^\n]{0,80}aguardando_pagamento/.test(html));
});

test('pedidos antigos continuam acessíveis: leitura da urgência é à parte e tolera falha', () => {
  assert.ok(html.includes("client.rpc('qf_chamados_urgencias'"));
  assert.ok(html.includes("urgencia: row.urgencia === 'urgente' ? 'urgente' : (row.urgencia === 'normal' ? 'normal' : null),"));
  assert.ok(html.includes("console.warn('QuemFaz urgência dos pedidos', err);"));
  assert.match(ext, /QFUrgencia/);
});

test('admin não mostra mais "Pra quando"/"Sem pressa"', () => {
  assert.ok(!admin.includes("'Sem pressa'"));
  assert.ok(!admin.includes("'Pra quando'"));
  assert.ok(admin.includes("'Urgência'"));
});

test('migração: aditiva, sem tocar em pedidos, sem aviso novo', () => {
  assert.ok(sql.includes('add column if not exists urgencia text;'));
  assert.ok(sql.includes("new.urgencia not in ('normal', 'urgente')"));
  assert.ok(sql.includes('exception when others then'));
  assert.ok(sql.includes('create or replace function public.qf_chamados_urgencias(p_ids uuid[])'));
  assert.ok(sql.includes('grant execute on function public.qf_chamados_urgencias(uuid[]) to authenticated;'));
  assert.ok(sql.includes("case when ch.urgencia = 'urgente' then 'URGENTE' end,"));
  assert.ok(!/^\s*(update|delete|truncate)\b/im.test(sql), 'a migração não altera nem apaga pedidos');
  assert.ok(!/create (or replace )?trigger[\s\S]*after insert/i.test(sql), 'nenhum gatilho de aviso novo');
  ['qf_disparar_push_novo_chamado', 'qf_cascata_iniciar', 'qf_expirar_chamados', 'qf_fechar_sem_retorno'].forEach((f) => assert.ok(!sql.includes(f)));
});

test('pedido antigo com prazo hoje/amanhã aparece como urgente; demais, Normal', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes("req.prazo === 'hoje' || req.prazo === 'amanha'"));
});
