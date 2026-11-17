const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('piloto editorial preserva formulário e remove repetições', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'servicos', 'eletricista', 'santo-andre', 'index.html'), 'utf8');
  assert.match(html, /id="seo-order"/);
  assert.match(html, /href="#pedido"/);
  assert.match(html, /rel="canonical" href="https:\/\/quemfazservico.com.br\/servicos\/eletricista\/santo-andre\/"/);
  assert.match(html, /Instalações e trocas: defina cada ponto do serviço/);
  assert.match(html, /Quais detalhes ajudam a pedir eletricista em Santo André\?/);
  assert.doesNotMatch(html, /<h2>Quando solicitar eletricista\?<\/h2>/);
  assert.doesNotMatch(html, /<h2>Como explicar uma falha elétrica\?<\/h2>/);
});
