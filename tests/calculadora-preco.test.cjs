// V11.31 — calculadora de preço ("Quanto custa?"): tabela de faixas, rota e ganchos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

// Scripts continuam com sintaxe válida e a versão do app bate com a do service worker.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));
const appV = /const APP_VERSION = '([^']+)'/.exec(html)[1];
const swV = /const SW_VERSION = '([^']+)'/.exec(sw)[1];
assert.equal(appV, swV);

// Módulo da calculadora, rodado isolado (sem tela).
const a = html.indexOf('/* QuemFaz V11.31 — calculadora de preço');
const b = html.indexOf('/* QuemFaz — casca do app, roteador por hash e navegação. */');
assert.ok(a > 0 && b > a);
const antesAnon = [], antesLogado = [];
const win = {
  PU: { escapeHtml: (v) => String(v).replace(/</g, '&lt;') },
  icon: () => '<svg></svg>',
  Screens: { afterRenderAnon: (p) => antesAnon.push(p), afterRender: (p) => antesLogado.push(p) }
};
vm.runInNewContext(html.slice(html.indexOf('(function (global) {', a), b), { window: win, Date, Math, Number, String, Array, Object, JSON, console });
const C = win.QFCalc;
assert.ok(C && C.tabela.length >= 6);

// Toda categoria da calculadora existe no app, e toda combinação dá uma faixa válida e redonda.
C.tabela.forEach((s) => {
  assert.ok(html.includes("id: '" + s.cat + "'"), 'categoria inexistente: ' + s.cat);
  assert.ok(s.p1.ops.length >= 2 && s.p2.ops.length >= 2);
  s.p1.ops.forEach((_, i1) => s.p2.ops.forEach((__, i2) => {
    const f = C.faixa(s, i1, i2);
    assert.ok(f.min >= 10 && f.max > f.min, s.cat + ' ' + i1 + '/' + i2);
    assert.equal(f.min % 10, 0);
    assert.equal(f.max % 10, 0);
    const r = C.resultado(s, i1, i2);
    assert.equal(r.cat, s.cat);
    assert.ok(r.descricao.length >= 8);   // o formulário exige pelo menos 8 letras na descrição
  }));
});
assert.equal(C.faixa(C.tabela[0], 99, 0), null);
assert.equal(C.brl(1800), 'R$ 1.800');
assert.equal(C.brl(80), 'R$ 80');

// Informática · Está lento · Notebook (exemplo aprovado no desenho).
const info = C.tabela.find((s) => s.cat === 'cat_informatica');
const r = C.resultado(info, 1, 0);
assert.deepEqual({ min: r.min, max: r.max }, { min: 90, max: 220 });
assert.equal(r.resumo, 'Informática · Está lento · Notebook');

// Os ganchos antigos continuam sendo chamados (nada é substituído).
win.Screens.afterRenderAnon('/como-funciona', {}, {});
win.Screens.afterRender('/cliente/home', {}, {}, {});
assert.deepEqual(antesAnon, ['/como-funciona']);
assert.deepEqual(antesLogado, ['/cliente/home']);

// Rota aberta ao visitante e formulário de pedido intacto (a calculadora reaproveita o mesmo formulário).
assert.ok(html.includes("{ pattern: '/calculadora', anon: true"));
assert.ok(html.includes('id="cadastro-cliente-form"'));
assert.ok(html.includes('Receber orçamentos grátis'));
assert.ok(html.includes('data-landing-service-form'));

console.log('calculadora-preco: ok');
