const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Pergunta aparece somente em pedidos ativos com pelo menos 72 horas', () => {
  const code = fs.readFileSync('qf-feedback-72h.js', 'utf8');
  const head = { appendChild() {} };
  const window = { document: { createElement() { return { textContent: '' }; }, head } };
  vm.runInNewContext(code, { window });
  const now = Date.now();
  const old = new Date(now - 73 * 3600000).toISOString();
  const recent = new Date(now - 71 * 3600000).toISOString();
  assert.equal(window.QFFeedback72.eligible({ id: 'a', status: 'em_negociacao', criadoEm: old }), true);
  assert.equal(window.QFFeedback72.eligible({ id: 'a', status: 'aberto', criado_em: recent }), false);
  assert.equal(window.QFFeedback72.eligible({ id: 'a', status: 'cancelado', criado_em: old }), false);
  assert.equal(window.QFFeedback72.eligible({ id: 'a', status: 'concluido', criado_em: old }), false);
});

test('Feedback não executa alterações automáticas de status, fechamento ou Pix', () => {
  const code = fs.readFileSync('qf-feedback-72h.js', 'utf8');
  assert.match(code, /\.from\('qf_pedido_feedback_72h'\)\.insert\(/);
  assert.doesNotMatch(code, /\.from\('qf_chamados'\)\.(?:update|delete)/);
  assert.match(code, /Sua resposta não confirma conclusão nem movimenta pagamentos/);
  const migration = fs.readFileSync('supabase/migrations/20261114033000_feedback_cliente_72h.sql', 'utf8');
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /cliente_id = \(select auth\.uid\(\)\)/);
});
