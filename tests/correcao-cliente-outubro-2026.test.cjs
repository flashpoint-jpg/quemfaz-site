const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

test('etapa de opções não pede mais data/prazo: só Normal ou Urgente', () => {
  assert.ok(!html.includes('function prazoFieldHtml()'));
  assert.ok(!html.includes('data-qf-prazo-erro'));
  const start = html.indexOf('async function avancarSub()');
  const end = html.indexOf('form.__qfAvancarSub = avancarSub', start);
  assert.ok(start !== -1 && end > start);
  const code = html.slice(start, end);
  assert.ok(!code.includes('P.montar('), 'não valida mais data na etapa de opções');
  assert.ok(code.includes("irSub('c')"));
});

test('nome e icone do servico escolhido acompanham a troca', () => {
  assert.match(html, /data-servico-escolhido-nome/);
  assert.match(html, /data-servico-escolhido-icone/);
  const start = html.indexOf('function atualizarServicoVisivel()');
  const end = html.indexOf('function renderServicoSuggestions()', start);
  assert.ok(start > 0 && end > start);
  const fn = html.slice(start, end);
  assert.match(fn, /servicoNomeVisivel.textContent = nome/);
  assert.match(fn, /servicoIconeVisivel.innerHTML = icon/);
  const input = html.slice(html.indexOf("servicoEditInput.addEventListener('input'"), html.indexOf("if(servicoSuggestions){",start));
  assert.match(input, /atualizarServicoVisivel\(\)/);
  const click = html.slice(html.indexOf("servicoSuggestions.addEventListener('click'"), html.indexOf('// V11.37: pedido',start));
  assert.match(click, /servicoHidden.value=cat.nome;\s*atualizarServicoVisivel\(\)/);
});

test('titulo, descricao, calculadora e app usam limite de ate 4', () => {
  assert.match(html, /Receba até 4 Contatos Grátis/);
  assert.doesNotMatch(html, /Receba até 3 Contatos Grátis/);
  assert.doesNotMatch(html, /receba até 3 contatos de profissionais/);
  assert.match(html, /até 4 profissionais podem chamar você no WhatsApp/);
  assert.doesNotMatch(html, /até 3 profissionais podem chamar você no WhatsApp/);
  assert.match(html, /const maxProf = Math.max\(1, Math.min\(4,/);
  assert.match(html, /textoProf = maxProf === 1/);
  assert.ok(html.includes("<span>' + textoProf + '</span>"));
  assert.match(html, /\[1, 2, 3, 4\]/);
  const version = /const APP_VERSION = '([^']+)'/.exec(html);
  assert.ok(version);
  assert.equal(version[1], /const SW_VERSION = '([^']+)'/.exec(sw)[1]);
});
