const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'quemfaz-cliente-rapido', 'index.ts'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-03-sem-devolucao-de-lead.sql'), 'utf8');

[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));

// Validação de celular (site).
const a = html.indexOf("  const QF_DDDS = '");
const b = html.indexOf('  function field(label, controlHtml) {');
assert.ok(a > 0 && b > a);
const scope = { global: {} };
vm.runInNewContext(html.slice(a, b), scope);
const ok = scope.global.QFUI.validPhone;
['11966532473', '(11) 96653-2473', '5511966532473', '+55 35 98842-1307', '11912340987'].forEach(n => assert.equal(ok(n), true, n));
['1199990000', '11999990000', '11999999999', '1133334444', '00987654321', '20987654321', '11812345678', '11912345678', '35987654321', '119665324', ''].forEach(n => assert.equal(ok(n), false, n));

// Mesma regra no servidor.
const ea = edge.indexOf('const DDDS = new Set(');
const eb = edge.indexOf('function isInternalEmail');
const es = {};
vm.runInNewContext(edge.slice(ea, eb).replace('function validMobile(d: string)', 'function validMobile(d)') + '\nthis.v = validMobile;', es);
assert.equal(es.v('11966532473'), true);
['1199990000', '11999990000', '1133334444', '11812345678'].forEach(n => assert.equal(es.v(n), false, n));
assert.ok(edge.includes('if (!validMobile(telefone))'));

// Sem promessa de devolução nem de cancelamento em 48h.
assert.ok(!/volta (automaticamente|sozinho)/.test(html));
assert.ok(!html.includes('seu pedido será cancelado'));
assert.ok(!html.includes("fillRefundSummary(content);"));
assert.ok(html.includes('Desbloqueio sem devolução'));
assert.ok(html.includes('Não há devolução.'));
assert.match(sql, /'devolucao_lead', '\{"ativo": false\}'/);
assert.match(sql, /cron\.alter_job\(jobid, active := false\)/);
console.log('telefone-sem-devolucao: ok');
