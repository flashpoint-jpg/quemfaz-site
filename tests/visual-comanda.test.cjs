const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Scripts continuam com sintaxe válida.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));

// O visual novo nunca vale para a tela inicial: toda regra do bloco que mexe em algo
// que já existia no app vem presa a "#app-shell" com rota diferente de "inicio".
const m = html.match(/<style id="qf-skin-comanda">([\s\S]*?)<\/style>/);
assert.ok(m, 'bloco do visual novo');
const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');
const seletores = [];
css.replace(/@media[^{]+\{/g, '').split('}').forEach((bloco) => {
  const sel = bloco.split('{')[0].trim();
  if (sel) sel.split(',').forEach((x) => seletores.push(x.trim()));
});
assert.ok(seletores.length > 30);
seletores.forEach((sel) => {
  const novo = /^\.qf-(perf|ticket|tape|hero|steps|step|now-title)/.test(sel);
  const preso = sel.startsWith('#app-shell:not([data-route="inicio"])') || /^#app-shell\[data-route="(cliente-home|profissional-chamada)"\]/.test(sel);
  assert.ok(novo || preso, 'regra solta que poderia mudar a tela inicial: ' + sel);
});

// A tela inicial não usa nenhuma das classes novas.
const a = html.indexOf("'<section class=\"qf-landing-hero\">");
assert.ok(a > 0);
const landing = html.slice(html.lastIndexOf('const heroBanner', a), html.indexOf('};', a));
['qf-perf', 'qf-ticket', 'qf-tape', 'qf-hero"', 'qf-steps'].forEach((c) => assert.ok(!landing.includes(c), 'tela inicial usando ' + c));

// Peças do visual novo no lugar.
assert.ok(html.includes('<h1 class="qf-hero__title">O que você precisa hoje?</h1>'));
assert.ok(html.includes("['Pedido publicado', 'Em contato', 'Serviço feito', 'Avaliação']"));
assert.ok(html.includes('class="card stack qf-ticket" data-qf-fechamento'));
assert.ok(html.includes(".replace('<!--qf-chat-->', cta)"));
assert.ok(html.includes('data-action="fechei-servico"') && html.includes('data-action="nao-fechei-servico"'));
console.log('visual-comanda: ok');
