// V11.79: Pedido urgente opcional na etapa de escolhas do pedido do cliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('pedido normal grátis vem marcado e o urgente é opcional', () => {
  assert.match(html, /data-qf-envio-opt="normal">/);
  assert.match(html, /role="radio" aria-checked="true" data-qf-envio-opt="normal"/);
  assert.match(html, /role="radio" aria-checked="false" data-qf-envio-opt="urgente"/);
  assert.match(html, /<input type="hidden" name="urgente" value="0">/);
});

test('urgente só pede prioridade com a nuvem ligada e manda para o Pix', () => {
  assert.match(html, /const querUrgente = !!\(global\.QFCloud && global\.QFCloud\.enabled\) && String\(fd\.get\('urgente'\) \|\| ''\) === '1';/);
  assert.match(html, /prioridade: querUrgente,/);
  assert.match(html, /location\.href = pagUrgente\.checkoutUrl;/);
});

test('versão do app e do service worker iguais', () => {
  const app = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  const sw = /const SW_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'))[1];
  assert.equal(app, sw);
});
