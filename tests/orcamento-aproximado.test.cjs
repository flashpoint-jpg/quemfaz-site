const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../qf-valor-definido.js');
const load = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('orçamento é opcional: vazio é válido e não exige preço fechado', () => {
  assert.deepEqual(V.validarOrcamento(''), { ok: true, centavos: null });
  assert.deepEqual(V.validarOrcamento('   '), { ok: true, centavos: null });
  assert.deepEqual(V.validarOrcamento(null), { ok: true, centavos: null });
});

test('orçamento aceita formato brasileiro e rejeita lixo, mínimo e máximo', () => {
  assert.equal(V.validarOrcamento('R$ 1.500,00').centavos, 150000);
  assert.equal(V.validarOrcamento('1500').centavos, 150000);
  assert.equal(V.validarOrcamento('90,5').centavos, 9050);
  assert.equal(V.validarOrcamento('abc').ok, false);
  assert.equal(V.validarOrcamento('0').ok, false);
  assert.equal(V.validarOrcamento('5').ok, false);
  assert.equal(V.validarOrcamento('600000').ok, false);
});

test('campo do formulário: texto pedido, aviso de valor aproximado, sem contratação nem confirmação', () => {
  const h = V.campoOrcamentoHtml();
  assert.match(h, /Quanto você está disposto a gastar aproximadamente com esse serviço\?/);
  assert.match(h, /Ex\.: R\$ 1\.500,00/);
  assert.match(h, /valor aproximado/i);
  assert.match(h, /não está contratando/i);
  assert.match(h, /grátis/i);
  assert.doesNotMatch(h, /type="checkbox"|confirmo|valor definido|taxa|6%/i);
  assert.match(h, /name="orcamentoAprox"/);
});

test('exibição ao profissional: valor formatado, aviso de estimativa, nada sem orçamento, HTML escapado', () => {
  const h = V.orcamentoHtml(150000);
  assert.match(h, /Orçamento aproximado do cliente/);
  assert.match(h, /R\$\s*1\.500,00/);
  assert.match(h, /não é preço fechado/);
  assert.equal(V.orcamentoHtml(null), '');
  assert.equal(V.orcamentoHtml(0), '');
  assert.equal(V.orcamentoHtml('<script>'), '');
});

test('enriquecerOrcamento anexa só o que o banco devolve e falha em silêncio', async () => {
  const calls = [];
  global.QFCloud = { client: { rpc(n, a) { calls.push([n, a]); return Promise.resolve({ data: [{ chamado_id: 'a', orcamento_aproximado_centavos: 80000 }], error: null }); } } };
  const reqs = [{ id: 'a' }, { id: 'b' }, { id: 'c', orcamentoAproxCentavos: 5000 }];
  await V.enriquecerOrcamento(reqs);
  assert.equal(reqs[0].orcamentoAproxCentavos, 80000);
  assert.equal(reqs[1].orcamentoAproxCentavos, undefined);
  assert.equal(reqs[2].orcamentoAproxCentavos, 5000);
  assert.deepEqual(calls[0], ['qf_orcamento_info_chamados', { p_ids: ['a', 'b'] }]);
  global.QFCloud = { client: { rpc() { return Promise.reject(new Error('x')); } } };
  const r2 = [{ id: 'z' }];
  assert.equal((await V.enriquecerOrcamento(r2))[0].id, 'z');
});

test('index.html: um único fluxo, orçamento sem depender de chave, sem 6% e sem seletor A/B', () => {
  const html = load('index.html');
  assert.match(html, /qf-valor-definido\.js\?v=3/);
  assert.match(html, /global\.QFValor\.campoOrcamentoHtml\(\)/);
  assert.match(html, /global\.QFValor\.validarOrcamento\(fd\.get\('orcamentoAprox'\)\)/);
  assert.match(html, /orcamentoAproxCentavos: orcamentoAprox/);
  assert.match(html, /maxOrcamentos: Number\(fd\.get\('maxOrcamentos'\)\) \|\| 3/);
  assert.match(html, /row\.orcamento_aproximado_centavos = orcAprox/);
  assert.match(html, /QFValor\.orcamentoHtml\(req\.orcamentoAproxCentavos\)/);
  assert.doesNotMatch(html, /seletorModalidadeHtml|desbloquear-valor|valorPainelPro|valorDefinido|afterValorUnlock|taxa de indicação/);
  // desbloqueio normal e exclusivo continuam na função transacional existente
  assert.match(html, /client\.rpc\('qf_desbloquear_chamado', exclusivo \? \{ p_chamado_id: chamadoId, p_exclusivo: true \}/);
  assert.match(html, /ativo: true, mult: 4,/);
});

test('migração corretiva: orçamento, 4x, sem percentual e sem tocar preços, saldos ou recargas', () => {
  const sql = load('supabase/2026-10-18-orcamento-aproximado-exclusivo-4x.sql');
  assert.match(sql, /orcamento_aproximado_centavos/);
  assert.match(sql, /'\{"ativo": true, "multiplicador": 4\}'/);
  assert.match(sql, /modalidade_descontinuada/);
  assert.doesNotMatch(sql, /update\s+public\.qf_precos_desbloqueio|qf_carteiras|qf_recargas|qf_movimentacoes|delete\s+from|truncate/i);
  // a função transacional de desbloqueio não é reescrita
  assert.doesNotMatch(sql, /function public\.qf_desbloquear_chamado\(/);
});

test('o formulário e o desbloqueio não citam percentual de taxa', () => {
  assert.doesNotMatch(load('qf-valor-definido.js'), /percentual|6%|calcularTaxa|taxa de indica/i);
});
