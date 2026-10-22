const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../qf-valor-definido.js');

test('parseBRL entende formatos brasileiros e rejeita lixo', () => {
  assert.equal(V.parseBRL('1.500,00'), 150000);
  assert.equal(V.parseBRL('R$ 1.500'), 150000);
  assert.equal(V.parseBRL('1500'), 150000);
  assert.equal(V.parseBRL('90,5'), 9050);
  assert.equal(V.parseBRL('1500.50'), 150050);
  assert.equal(V.parseBRL(''), null);
  assert.equal(V.parseBRL('abc'), null);
  assert.equal(V.parseBRL(null), null);
});

test('formatBRL', () => {
  assert.equal(V.formatBRL(150000), 'R$ 1.500,00');
  assert.equal(V.formatBRL(9005), 'R$ 90,05');
  assert.equal(V.formatBRL(0), 'R$ 0,00');
});

test('HTML escapa conteúdo do usuário', () => {
  assert.ok(V.baixaHtml('https://x/?"><script>', '2026-10-25').indexOf('<script>') === -1);
  assert.equal(V.esc('<b>"a"</b>'), '&lt;b&gt;&quot;a&quot;&lt;/b&gt;');
});

test('cancelamento oferece os 5 motivos do contrato com o banco', () => {
  assert.deepEqual(V.MOTIVOS_CANCELAMENTO.map(m => m.id), ['imprevisto', 'financeiro', 'nao_precisa_mais', 'nao_combinou', 'outro']);
  assert.deepEqual(V.RESPOSTAS_CONCLUSAO.map(m => m.id), ['concluido', 'com_problema', 'nao_realizado']);
});

test('link seguro: token só no fragmento (#), nunca na query', () => {
  const tok = 'a'.repeat(64);
  const link = V.linkConfirmacao('https://quemfazservico.com.br/', tok);
  assert.equal(link, 'https://quemfazservico.com.br/confirmar-servico.html#t=' + tok);
  assert.equal(V.tokenDoHash('#t=' + tok), tok);
  assert.equal(V.tokenDoHash('#t=curto'), null);
  assert.equal(V.tokenDoHash(''), null);
});

test('falha na configuração mantém tudo desligado', async () => {
  global.QFCloud = { client: { rpc() { return Promise.reject(new Error('x')); } } };
  await V.carregarConfig(true);
  assert.equal(V.ativo(), false);
});
