const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('index.html','utf8');

test('cliente não recebe quadro de código de acesso após publicar', () => {
  assert.doesNotMatch(html, /function fillClienteCodigoAcesso\(/);
  assert.doesNotMatch(html, /fillClienteCodigoAcesso\(content\)/);
  assert.match(html, /Pedidos abrem no aparelho onde foram publicados, sem pedir código/);
});

test('home oferece Meus pedidos e ajuda sem pedir login de cliente', () => {
  const first = html.indexOf('Screens.landing = function');
  const last = html.indexOf('function roleCard', first);
  const home = html.slice(first,last);
  assert.match(home, /data-action="landing-my-orders">Meus pedidos/);
  assert.match(home, /data-action="landing-my-orders"/);
  assert.match(home, /data-support-open/);
  assert.doesNotMatch(home, /data-nav="\/auth\/cliente\/login"/);
});

test('o atalho dos pedidos só usa sessão de cliente já presente, sem procurar pedidos pelo número', () => {
  const pos = html.indexOf('if(e.target.closest(\'[data-action="landing-my-orders"]\'))');
  assert.ok(pos > 0);
  const handler = html.slice(pos, pos + 520);
  assert.match(handler, /sess=DB\.getSession\(\)/);
  assert.match(handler, /sess\.role==='cliente'/);
  assert.match(handler, /global\.navigate\('\/cliente\/pedidos'\)/);
  assert.doesNotMatch(handler, /telefone|signInClienteWhatsapp|client\.rpc/);
});

test('links antigos de login cliente voltam para home e profissional mantém acesso', () => {
  assert.match(html, /if \(path === '\/auth\/cliente\/login'\) \{ navigate\('\/', true\); return; \}/);
  assert.match(html, /data-nav="\/auth\/profissional\/login"/);
  assert.match(html, /if \(role === 'cliente'\) await syncClientCalls\(user\.id\)/);
  assert.match(html, /\{ pattern: '\/cliente\/pedidos', role: 'cliente'/);
});

test('publicação ainda coleta apenas dados necessários sem senha nem código', () => {
  const i=html.indexOf('function cadastroClienteView()');
  const j=html.indexOf('// V11.5.0: escolha', i);
  const formulario=html.slice(i,j);
  for(const campo of ['servico','descricao','cidade','uf','bairro','telefone','nome']){
    assert.ok(formulario.includes('name="'+campo+'"'),'campo '+campo);
  }
  assert.doesNotMatch(formulario,/name="codigo"|name="senha"/);
});
