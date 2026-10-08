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
  assert.match(view, /Usar GPS \(opcional\)/);
  assert.ok(!view.includes('getCurrentPosition'));
});

test('endereço manual da home é preservado mesmo com GPS indisponível', async () => {
  let calls = 0;
  const ctx = {
    homeLocation: { value: 'Santo André / SP' },
    homeRegion: null,
    homeNeighborhood: { value: ' Vila Pires ' },
    landingSearch: { value: 'Pintor' },
    locationAutocomplete: {
      resolveRegion: async () => ({ cidade: 'Santo André', uf: 'SP' })
    },
    global: { QFGeo: { currentPosition: () => { calls++; throw new Error('GPS bloqueado'); } } }
  };
  vm.createContext(ctx);
  vm.runInContext(
    html.slice(html.indexOf('      async function saveHomeDraft(){'), html.indexOf('      function landingNorm(')),
    ctx
  );
  await ctx.saveHomeDraft();
  assert.equal(calls, 0, 'nunca solicitar GPS no preenchimento manual');
  assert.equal(ctx.global.QFHomeDraft.region.cidade, 'Santo André');
  assert.equal(ctx.global.QFHomeDraft.region.bairro, 'Vila Pires');
});

test('GPS é um botão de escolha explícita, sem substituir local manual automaticamente', () => {
  const start = html.indexOf("const clienteGpsBtn = content.querySelector('[data-cliente-gps]')");
  const end = html.indexOf('const telefoneInput = form.querySelector', start);
  assert.ok(start > 0 && end > start, 'tratamento do GPS opcional no formulário');
  const gps = html.slice(start, end);
  assert.match(gps, /addEventListener\('click', async function/);
  assert.match(gps, /QFGeo\.currentPosition\(\)/);
  assert.match(gps, /cidadePedido\.value = r\.cidade/);
  assert.match(gps, /bairroPedido\.value = r\.bairro/);
  assert.match(gps, /Confira cidade e bairro antes de publicar/);
  assert.match(html, /GPS é opcional/);
});
