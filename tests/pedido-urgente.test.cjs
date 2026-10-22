// V11.79: Pedido urgente opcional na etapa de escolhas do pedido do cliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('urgência Normal vem marcada, Urgente é grátis e a prioridade paga é outra escolha, desmarcada', () => {
  assert.match(html, /role="radio" aria-checked="true" data-qf-urgencia-opt="normal"/);
  assert.match(html, /role="radio" aria-checked="false" data-qf-urgencia-opt="urgente"/);
  assert.match(html, /<input type="hidden" name="urgencia" value="normal">/);
  assert.match(html, /Qual a urgência do seu serviço\?/);
  assert.match(html, /Quero receber orçamentos dos profissionais da minha região\./);
  assert.match(html, /Preciso de atendimento rápido\./);
  // As duas urgências são grátis; o valor só aparece na prioridade paga.
  const form = html.slice(html.indexOf('data-qf-urgencia>'), html.indexOf('data-qf-sub-ir="c"'));
  assert.equal((form.match(/qf-envio__preco--gratis">Grátis</g) || []).length, 2);
  assert.match(form, /<input type="checkbox" name="prioridade" value="1">/);
  assert.doesNotMatch(form, /name="prioridade" value="1" checked/);
  assert.match(form, /Dar prioridade ao meu pedido/);
  assert.match(form, /Opcional e pago/);
  assert.match(form, /R\$ 9,90 no Pix/);
  // Escolher Urgente não liga a prioridade paga.
  const fn = html.slice(html.indexOf('function modoUrgencia(modo) {'), html.indexOf('function atualizarPrioridade() {'));
  assert.ok(fn.length > 100 && !fn.includes('prioridade') && !fn.includes('checked ='));
});

test('só a prioridade paga pede Pix; a urgência vai gravada no pedido', () => {
  assert.match(html, /const querUrgente = !!\(global\.QFCloud && global\.QFCloud\.enabled\) && String\(fd\.get\('prioridade'\) \|\| ''\) === '1';/);
  assert.match(html, /const urgenciaEscolhida = String\(fd\.get\('urgencia'\) \|\| ''\) === 'urgente' \? 'urgente' : 'normal';/);
  assert.match(html, /prioridade: querUrgente,/);
  assert.match(html, /global\.QFPixPrioridade\.abrir\(pedido\);/);
});

test('V11.80: Pix da prioridade aparece dentro do QuemFaz, sem ir para a Efí', () => {
  assert.match(html, /global\.QFPixPrioridade = \{ abrir: abrir \};/);
  assert.match(html, /data-qf-pix-copy>Copiar código Pix/);
  assert.match(html, /from\('qf_prioridade_pagamentos'\)\.select\('status'\)/);
  assert.doesNotMatch(html, /location\.href = (pagUrgente\.checkoutUrl|checkoutUrl|out\.checkout_url);/);
});

test('versão do app e do service worker iguais', () => {
  const app = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  const sw = /const SW_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'))[1];
  assert.equal(app, sw);
});

test('V11.81: pedido urgente só é publicado depois do Pix', () => {
  assert.match(html, /status: data\.prioridade \? 'aguardando_pagamento' : 'aberto',/);
  assert.match(html, /aguardandoPagamento: row\.status === 'aguardando_pagamento',/);
  assert.match(html, /Pagar Pix e publicar/);
});
