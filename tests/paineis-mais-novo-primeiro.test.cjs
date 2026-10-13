// Painéis do admin: pedido mais novo aparece primeiro; o número "mais antigo parado há" continua certo.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
assert.ok(admin.includes("pedidosPainel.sort(function (a, b) { return (Date.parse(b.criado_em) || 0) - (Date.parse(a.criado_em) || 0); });"), 'ordena do mais novo para o mais antigo');
assert.ok(admin.includes("(maisAntigo ? pnHa(maisAntigo, agora) : '—')"), 'mais antigo calculado pela data, não pela posição');
assert.ok(!admin.includes('pnHa(pedidos[0].criado_em, agora)'));
