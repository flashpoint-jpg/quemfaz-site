const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

test('Escolher data exige dia na etapa de opções, antes do contato', () => {
  const field = html.slice(html.indexOf('function prazoFieldHtml()'), html.indexOf('function bindPrazoField('));
  assert.match(field, /data-qf-prazo-erro role="alert"/);
  const start = html.indexOf('async function avancarSub()');
  const end = html.indexOf('form.__qfAvancarSub = avancarSub', start);
  assert.ok(start !== -1 && end > start);
  const code = html.slice(start, end);
  const optionStart = code.indexOf("} else if (sub === 'b')");
  const dateValidation = code.indexOf('P.montar(', optionStart);
  const contact = code.indexOf("irSub('c')", optionStart);
  const reject = code.indexOf('if (!validacao.ok)', dateValidation);
  const stop = code.indexOf('return;', reject);
  assert.ok(optionStart > -1 && dateValidation > optionStart && reject > dateValidation);
  assert.ok(stop > reject && stop < contact && dateValidation < contact);
  assert.match(code.slice(reject, contact), /campoDia.setAttribute\('aria-invalid', 'true'\)/);
  assert.match(code.slice(reject, contact), /erro.hidden = false/);
  assert.match(html, /if \(validacao.ok\) \{\s*dia.removeAttribute\('aria-invalid'\)/);
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

test('titulo, descricao, calculadora e app usam limite de ate 8', () => {
  assert.match(html, /Receba até 8 Contatos Grátis/);
  assert.doesNotMatch(html, /Receba até 3 Contatos Grátis/);
  assert.doesNotMatch(html, /receba até 3 contatos de profissionais/);
  assert.match(html, /até 8 profissionais podem chamar você no WhatsApp/);
  assert.doesNotMatch(html, /até 3 profissionais podem chamar você no WhatsApp/);
  assert.match(html, /const maxProf = Math.max\(1, Math.min\(8,/);
  assert.match(html, /textoProf = maxProf === 1/);
  assert.match(html, /'<span>' \+ textoProf \+ '<\/span>'/);
  assert.match(html, /\[1, 2, 3, 4, 5, 6, 7, 8\]/);
  const version = /const APP_VERSION = '([^']+)'/.exec(html);
  assert.ok(version);
  assert.equal(version[1], /const SW_VERSION = '([^']+)'/.exec(sw)[1]);
});
