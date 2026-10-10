const fs = require('node:fs');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const html = fs.readFileSync('index.html', 'utf8');

test('botao de orçamento do cliente fica fixo no celular e preserva submit original', () => {
  const start = html.indexOf('/* Pedido do cliente no celular: CTA sempre ao alcance');
  const end = html.indexOf('@media (max-width: 430px)', start);
  assert.ok(start > 0 && end > start);
  const style = html.slice(start, end);
  assert.match(style, /@media \(max-width: 767px\)/);
  assert.match(style, /#cadastro-cliente-form \.qf-request-submit\s*\{[\s\S]*position: fixed/);
  assert.match(style, /bottom: calc\(12px \+ env\(safe-area-inset-bottom/);
  assert.match(style, /padding-bottom: calc\(110px \+ env/);
  assert.match(html, /class="btn btn--primary qf-request-submit" type="submit"/);
  assert.equal((html.match(/class="btn btn--primary qf-request-submit" type="submit"/g) || []).length, 1);
  assert.doesNotMatch(style, /:has\(input:focus,textarea:focus,select:focus\).*visibility:\s*hidden/);
  assert.doesNotMatch(style, /pointer-events:\s*none/);
  assert.match(style, /visibility:\s*visible/);
  assert.match(style, /--qf-keyboard-inset/);
});

test('formulario encurtado nao remove campos necessarios nem medicao de conversao', () => {
  const start = html.indexOf('  function cadastroClienteView()');
  const end = html.indexOf('  // V11.5.0: escolha',start);
  const section = html.slice(start,end);
  for (const field of ['servico','descricao','cidade','uf','bairro','telefone','nome']) {
    assert.ok(section.includes('name="' + field + '"'),field);
  }
  assert.ok(html.includes('QFClientAcquisition.published'));
  assert.ok(html.includes('qf_request') || html.includes('qf_chamados'));
  assert.ok(section.includes("servicoInicial.toLowerCase()"),'placeholder segue categoria');
  assert.ok(!section.includes('placeholder="Ex.: preciso pintar dois quartos e uma sala"'));
});

test('pedido reúne contato e localização no mesmo cartão, sem bloco separado', () => {
  const start = html.indexOf('  function cadastroClienteView()');
  const end = html.indexOf('  // V11.5.0: escolha',start);
  const view = html.slice(start,end);
  assert.ok(view.includes('qf-request-ticket qf-request-unified'));
  // V11.37: local e contato ficam juntos na etapa 2, dentro do mesmo cartão.
  // V11.71: a etapa 2 virou três telas no mesmo cartão: onde é (a), escolhas abertas em botões (b) e contato (c).
  const etapa2 = view.indexOf('data-qf-etapa-box="2"');
  const region = view.indexOf('          regionField +', etapa2);
  const escolhas = view.indexOf('data-qf-sub-box="b"', region);
  const quantos = view.indexOf('data-qf-quantos', escolhas);
  const contact = view.indexOf('class="qf-request-contact"', quantos);
  assert.ok(etapa2 > 0 && region > etapa2 && escolhas > region && quantos > escolhas && contact > quantos);
  assert.match(view, /data-qf-prazo-details/);
  assert.ok(!view.includes('<details class="qf-request-schedule"'), 'prazo fica aberto, sem precisar tocar para abrir');
  assert.ok(view.includes('[1, 2, 3, 4, 5, 6, 7, 8]') && view.includes('name="maxOrcamentos" value="3"'));
  assert.ok(view.includes('Para o profissional entrar em contato'));
});

test('erro em nome ou WhatsApp mostra campo sem esconder CTA', () => {
  assert.match(html, /showFieldError\('nome', 'Informe seu nome/);
  assert.match(html, /showFieldError\('telefone', 'Confira o WhatsApp/);
  assert.doesNotMatch(html, /qf-client-request:has\(input:focus,textarea:focus,select:focus\) \.qf-request-submit[\s\S]*visibility: hidden/);
  assert.match(html, /global\.visualViewport\.addEventListener\('resize', ajustarTeclado\)/);
});
