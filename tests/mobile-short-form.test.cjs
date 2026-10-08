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
  assert.match(style, /:has\(input:focus,textarea:focus,select:focus\)/);
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
