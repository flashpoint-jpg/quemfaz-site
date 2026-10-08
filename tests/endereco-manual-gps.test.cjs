const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const html = fs.readFileSync('index.html', 'utf8');

test('cliente pode informar outro local manualmente, sem precisar de GPS', () => {
  const ctx = {
    global: {
      QFHomeDraft: { region: { cidade: 'Santo André', uf: 'SP', bairro: 'Vila Pires' } },
      QFGeo: { ufOptions: () => '<option value="SP">SP</option>' }
    },
    sessionStorage: { getItem: () => null },
    DB: { categoryById: () => null, categories: () => [] },
    PU: { escapeHtml: value => String(value || '') },
    field: (label, input) => '<label>' + label + input + '</label>',
    icon: () => '', prazoFieldHtml: () => '', cadastroClienteAdsHtml: () => ''
  };
  vm.createContext(ctx);
  vm.runInContext(
    html.slice(html.indexOf('  function cadastroClienteView()'), html.indexOf('  // V11.5.0: escolha')),
    ctx
  );
  const view = ctx.cadastroClienteView();
  assert.match(view, /Cidade ou CEP do serviço/);
  assert.match(view, /Bairro do serviço/);
  assert.match(view, /value="Santo André"/);
  assert.match(view, /value="Vila Pires"/);
  assert.match(view, /data-cliente-gps/);
  assert.match(view, /Usar minha localização \(GPS\)/);
  assert.ok(!view.includes('getCurrentPosition'));
});

test('index não pede local nem GPS: o local fica na etapa 2 do pedido', async () => {
  let calls = 0;
  const ctx = { landingSearch: { value: 'Pintor' }, global: { QFGeo: { currentPosition: () => { calls++; } } } };
  vm.createContext(ctx);
  vm.runInContext(
    html.slice(html.indexOf('      async function saveHomeDraft(){'), html.indexOf('      function landingNorm(')),
    ctx
  );
  await ctx.saveHomeDraft();
  assert.equal(calls, 0, 'nunca solicitar GPS no index');
  assert.equal(ctx.global.QFHomeDraft.service, 'Pintor');
});

test('GPS é um botão de escolha explícita, sem substituir local manual automaticamente', () => {
  const start = html.indexOf("const clienteGpsBtn = content.querySelector('[data-cliente-gps]')");
  const end = html.indexOf('if (telefoneInput) {', start);
  assert.ok(start > 0 && end > start, 'tratamento do GPS opcional no formulário');
  const gps = html.slice(start, end);
  assert.match(gps, /addEventListener\('click', async function/);
  assert.match(gps, /QFGeo\.currentPosition\(\)/);
  assert.match(gps, /cidadePedido\.value = r\.cidade/);
  assert.match(gps, /bairroPedido\.value = r\.bairro/);
  assert.match(gps, /Confira cidade e bairro antes de publicar/);
});


test('index tem um campo só e o botão Pedir grátis; GPS fica no pedido', () => {
  const landing = html.slice(html.indexOf('  Screens.landing = function () {'), html.indexOf('  function roleCard('));
  assert.ok(!landing.includes('data-home-gps') && !landing.includes('data-landing-location'));
  assert.equal((landing.match(/<input /g) || []).length, 1);
  assert.match(landing, /<span>Pedir grátis<\/span>/);
  assert.match(html, /data-cliente-gps[^>]*>Usar minha localização \(GPS\)/);
});
