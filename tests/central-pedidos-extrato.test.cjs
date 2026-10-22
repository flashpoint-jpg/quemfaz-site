// V11.44: Central de pedidos mostra quem desbloqueou e a hora no pedido, e um extrato de desbloqueios.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

[...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'admin-' + i + '.js' }));
['adminExtratoHtml(all)', 'adminPedidoQuemHtml(r, cancelado || fechado)', 'Extrato de desbloqueios', 'Total do dia', 'depois do pedido', 'id="servicos-segmented"', 'id="servicos-lista"', "acoesHtml('servico', r.id)", 'data-crud-bulk=']
  .forEach((t) => assert.ok(admin.includes(t), t));

const i = admin.indexOf("  const QF_TZ = 'America/Sao_Paulo';");
const j = admin.indexOf('  function qfPedidoTitulo(r) {');
const sc = { Date, Number, String, Math, isNaN };
vm.runInNewContext(admin.slice(i, j) + '\nthis.hora = qfHora; this.dia = qfDiaChave; this.dur = qfDuracao; this.pg = qfDesbPagamento;', sc);
assert.equal(sc.hora('2026-10-09T17:40:00Z'), '14:40');           // horário de Brasília
assert.equal(sc.dia('2026-10-10T02:59:00Z'), '2026-10-09');        // 23h59 ainda é o dia anterior
assert.equal(sc.dur(8 * 60000), '8 min');
assert.equal(sc.dur(62 * 60000), '1h 02min');
assert.equal(sc.dur(3 * 86400000), '3 dias');
assert.deepEqual({ ...sc.pg({ valor: 790, origem: 'saldo' }) }, { valor: 790, rotulo: 'crédito' });
assert.deepEqual({ ...sc.pg({ valor: 790, origem: 'plano' }) }, { valor: 0, rotulo: 'plano' });
assert.deepEqual({ ...sc.pg({ valor: 0, origem: 'saldo' }) }, { valor: 0, rotulo: 'grátis' });
console.log('PASS central de pedidos: quem desbloqueou, hora e extrato');
