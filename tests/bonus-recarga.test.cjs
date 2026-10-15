// V12.1: preços redondos (R$ 5 / 8 / 13) e bônus de recarga na carteira.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/2026-10-14-bonus-recarga-menor.sql'), 'utf8');

const bloco = /const QFPrecos = global\.QFPrecos = ([\s\S]*?\n  \}\)\(\));/.exec(html)[1];
const P = vm.runInNewContext(bloco);

// Mesmas faixas do banco (V11.89): 5% a partir de R$ 50, 8% de R$ 100, 10% de R$ 200, teto R$ 100.
assert.strictEqual(P.bonus(2000), 0);
assert.strictEqual(P.bonus(4999), 0);
assert.strictEqual(P.bonus(5000), 250);
assert.strictEqual(P.bonus(10000), 800);
assert.strictEqual(P.bonus(20000), 2000);
assert.strictEqual(P.bonus(500000), 10000);
assert.ok(/>= 20000 then 10[\s\S]*>= 10000 then 8[\s\S]*>= 5000 then 5/.test(sql), 'faixas do banco');
assert.ok(sql.includes('least(10000,'), 'teto do banco');

// "Dá para X desbloqueios" pelo preço das profissões de cada um.
P.aplicar([{ categoria: 'cat_pintor', preco_centavos: 800 }, { categoria: 'cat_pedreiro', preco_centavos: 1300 }, { categoria: 'padrao', preco_centavos: 800 }]);
assert.strictEqual(P.quantos(5500, ['cat_pintor']), '6 desbloqueios');
assert.strictEqual(P.quantos(5500, ['cat_pedreiro']), '4 desbloqueios');
assert.strictEqual(P.quantos(5500, ['cat_pintor', 'cat_pedreiro']), '4 a 6 desbloqueios');
assert.strictEqual(P.quantos(800, ['cat_pintor']), '1 desbloqueio');
assert.strictEqual(P.quantos(0, []), '0 desbloqueios');

// Nenhum preço antigo sobrou nos textos do app.
for (const velho of ["'R$ 4,90'", "'R$ 7,90'", "'R$ 12,90'", 'R$ 4,90 a R$ 12,90']) assert.ok(!html.includes(velho), 'preço antigo: ' + velho);
