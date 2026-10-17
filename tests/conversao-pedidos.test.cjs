// V11.96 — eventos de conversão dos pedidos, consentimento, atribuição (msclkid) e páginas do ABC.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');

function storage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
function sandbox(opts) {
  opts = opts || {};
  const calls = { gtag: [], uet: [], fbq: [] };
  const local = storage(), session = storage();
  if (opts.consent) local.setItem('qf_consent_v1', JSON.stringify({ medicao: opts.consent }));
  const head = { appendChild: el => { if (el.onload) el.onload(); } };
  const win = {
    location: { search: opts.search || '', pathname: '/', hash: '', href: 'https://quemfazservico.com.br/' + (opts.search || ''), origin: 'https://quemfazservico.com.br' },
    localStorage: local, sessionStorage: session, dataLayer: [],
    gtag: function () { calls.gtag.push([].slice.call(arguments)); },
    fbq: function () { calls.fbq.push([].slice.call(arguments)); },
    QF_TRACKING_CONFIG: opts.config,
    UET: function (o) { return { push: function () { calls.uet.push([].slice.call(arguments)); } }; },
    document: {
      readyState: 'complete', referrer: '', head, documentElement: head,
      body: { appendChild() {}, classList: { toggle() {} }, style: {} },
      createElement: () => ({ setAttribute() {}, addEventListener() {}, remove() {}, style: {}, offsetHeight: 60 }),
      getElementById: () => null, querySelector: () => null, addEventListener() {}
    },
    MutationObserver: null,
    addEventListener() {}, removeEventListener() {}, setTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    crypto: { randomUUID: () => 'u-' + Math.random() }
  };
  win.window = win;
  vm.createContext(win);
  return { win, calls, local, session };
}
const conv = fs.readFileSync(path.join(root, 'qf-conversao.js'), 'utf8');
const acq = fs.readFileSync(path.join(root, 'qf-client-acquisition.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ID = '4b6f1c2e-9a7d-4e21-8f3b-1c2d3e4f5a6b';

test('pedido_publicado só com id confirmado e uma vez por pedido', () => {
  const { win } = sandbox({ config: { uet: '12345678' } });
  vm.runInContext(conv, win);
  assert.strictEqual(win.QFConversao.evento('pedido_publicado', {}), false, 'sem id do banco não envia');
  assert.strictEqual(win.QFConversao.evento('pedido_publicado', { request_id: ID, categoria: 'cat_eletricista' }), true);
  assert.strictEqual(win.QFConversao.evento('pedido_publicado', { request_id: ID }), false, 'mesmo pedido não duplica');
  assert.strictEqual(win.dataLayer.filter(e => e.event === 'pedido_publicado').length, 1);
});

test('eventos de etapa uma vez por sessão e nomes fora da lista são ignorados', () => {
  const { win } = sandbox();
  vm.runInContext(conv, win);
  assert.ok(win.QFConversao.evento('pedido_iniciado', {}));
  assert.ok(!win.QFConversao.evento('pedido_iniciado', {}));
  assert.ok(win.QFConversao.evento('pedido_formulario_avancado', {}));
  assert.ok(!win.QFConversao.evento('compra', {}));
});

test('nenhum dado pessoal chega às plataformas', () => {
  const { win, calls } = sandbox({ config: { uet: '12345678', ga4: 'G-ABC1234' } });
  vm.runInContext(conv, win);
  win.QFConversao.evento('pedido_publicado', { request_id: ID, categoria: 'cat_pintor', nome: 'Maria', telefone: '11987654321', bairro: 'Centro', descricao: 'pintar sala' });
  const enviado = JSON.stringify([win.dataLayer, calls.gtag, calls.uet]);
  for (const proibido of ['Maria', '11987654321', 'Centro', 'pintar sala', 'telefone', 'nome']) assert.ok(!enviado.includes(proibido), 'vazou: ' + proibido);
  assert.ok(calls.uet.some(c => c[0] === 'event' && c[1] === 'pedido_publicado'), 'UET recebe o evento');
  assert.ok(calls.gtag.some(c => c[0] === 'event' && c[1] === 'pedido_publicado'), 'GA4 recebe o evento');
});

test('sem ID real, GA4 e UET ficam desligados (nada inventado)', () => {
  const { win, calls } = sandbox({ config: { ga4: '', uet: '' } });
  vm.runInContext(conv, win);
  assert.strictEqual(win.QFConversao.config.ga4, '');
  assert.strictEqual(win.QFConversao.config.uet, '');
  win.QFConversao.evento('pedido_publicado', { request_id: ID });
  assert.strictEqual(calls.uet.length, 0);
  assert.ok(!calls.gtag.some(c => c[0] === 'event'));
});

test('recusa de cookies: nada vai para anúncios, só a camada local de dados', () => {
  const { win, calls } = sandbox({ consent: 'denied', config: { uet: '12345678', ga4: 'G-ABC1234' } });
  vm.runInContext(conv, win);
  assert.strictEqual(win.QFConversao.consentimento(), 'denied');
  win.QFConversao.evento('pedido_publicado', { request_id: ID });
  assert.strictEqual(calls.uet.filter(c => c[0] === 'event').length, 0);
  assert.ok(!calls.gtag.some(c => c[0] === 'event'));
  assert.strictEqual(win.dataLayer[0].qf_consentimento, 'denied');
  win.QFConversao.escolher('granted');
  assert.ok(calls.gtag.some(c => c[0] === 'consent' && c[1] === 'update' && c[2].ad_storage === 'granted'));
  assert.ok(calls.fbq.some(c => c[0] === 'consent' && c[1] === 'grant'));
});

test('aquisição: publicado dispara conversão; urgente aguardando Pix não', () => {
  const { win } = sandbox();
  const enviados = [];
  win.QFConversao = { evento: (n, d) => enviados.push([n, d]) };
  win.QFCloud = { enabled: true, client: { from: () => ({ insert: () => Promise.resolve({}) }) } };
  win.addEventListener = () => {};
  win.setTimeout = setTimeout;
  vm.runInContext(acq, win);
  win.QFClientAcquisition.published({ id: 'pix-1', aguardandoPagamento: true }, 'cat_encanador');
  assert.strictEqual(enviados.length, 0);
  win.QFClientAcquisition.published({ id: ID }, 'cat_encanador');
  assert.deepStrictEqual(enviados.map(e => e[0]), ['pedido_publicado']);
  assert.strictEqual(enviados[0][1].request_id, ID);
  win.QFClientAcquisition.published({ id: ID }, 'cat_encanador');
  assert.strictEqual(enviados.length, 1, 'recarregar a tela não duplica');
  win.QFClientAcquisition.track('form_start', {}, true);
  win.QFClientAcquisition.track('step_service_completed', {}, true);
  assert.deepStrictEqual(enviados.map(e => e[0]), ['pedido_publicado', 'pedido_iniciado', 'pedido_iniciado', 'pedido_formulario_avancado']); // o módulo real deduplica o segundo 'iniciado'
});

test('atribuição guarda msclkid (Microsoft Ads) com o tipo do clique', () => {
  const bloco = html.slice(html.indexOf('/* QF_MARKETING_ATTRIBUTION_V2'), html.indexOf('})();', html.indexOf('/* QF_MARKETING_ATTRIBUTION_V2')) + 5);
  const { win, session } = sandbox({ search: '?utm_campaign=quemfaz_abc&msclkid=abc123' });
  win.URLSearchParams = URLSearchParams; win.URL = URL; win.JSON = JSON; win.Date = Date;
  vm.runInContext(bloco, win);
  const t = JSON.parse(session.getItem('qf_marketing_touch'));
  assert.strictEqual(t.source, 'microsoft');
  assert.strictEqual(t.click_type, 'msclkid');
  assert.strictEqual(t.click_id, 'abc123');
  assert.ok(!t.landing_url.includes('msclkid'), 'URL guardada sem parâmetros');
});

test('consentimento definido antes das tags do Google e da Meta', () => {
  const c = html.indexOf('QF_CONSENT_V1'), meta = html.indexOf("fbq('init','1124265238584181')"), g = html.indexOf("gtag('config', 'AW-18273159663')"), d = html.indexOf("gtag('consent', 'default'");
  assert.ok(c > 0 && c < meta && d > 0 && d < g, 'ordem das tags');
  assert.ok(html.includes("if (!id) return; // conversão só com pedido confirmado no banco"));
});

test('formulário: aviso do urgente correto e dados preservados após erro', () => {
  assert.ok(html.includes('O pedido só é publicado depois que o Pix for pago.'));
  assert.ok(!html.includes('ele vira prioritário assim que o Pix cair.</p>'));
  assert.ok(html.includes("sessionStorage.setItem('qf_repeat_order_draft', JSON.stringify({ categoriaId: cat.id, descricao: descricao"));
});

test('guias do ABC: canonical, sitemap, schema e link direto para o formulário', () => {
  const dist = path.join(root, 'dist');
  const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
  for (const slug of ['limpeza-de-sofa', 'limpeza-de-estofados-e-tapetes', 'eletricista', 'encanador', 'pintor', 'diarista', 'marido-de-aluguel']) {
    const url = 'https://quemfazservico.com.br/servicos/' + slug + '/abc/';
    const page = fs.readFileSync(path.join(dist, 'servicos', slug, 'abc', 'index.html'), 'utf8');
    assert.ok(page.includes('<link rel="canonical" href="' + url + '">'), slug + ' canonical');
    assert.ok(sitemap.includes('<loc>' + url + '</loc>'), slug + ' sitemap');
    assert.ok(/<a class="cta" data-request href="\/\?servico=cat_[a-z_]+&amp;seo_page=%2Fservicos%2F[^"]+#\/auth\/cliente\/cadastro">/.test(page), slug + ' CTA');
    const ld = JSON.parse(page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
    assert.ok(ld.some(x => x['@type'] === 'FAQPage') && ld.some(x => x['@type'] === 'BreadcrumbList'));
    assert.ok(!/todos os profissionais (são )?verificados/i.test(page), 'sem promessa de verificação');
    assert.ok(/<meta name="description" content="[^"]{60,170}">/.test(page), slug + ' description');
  }
  // Página fina do ABC aponta para o guia e sai do sitemap; fora do ABC não muda.
  const fina = fs.readFileSync(path.join(dist, 'servicos', 'eletricista', 'maua', 'index.html'), 'utf8');
  assert.ok(fina.includes('<link rel="canonical" href="https://quemfazservico.com.br/servicos/eletricista/abc/">'));
  assert.ok(!sitemap.includes('/servicos/eletricista/maua/</loc>'));
  assert.ok(sitemap.includes('/servicos/limpeza-de-sofa/sao-bernardo-do-campo/</loc>'), 'editorial de sofá no sitemap');
  assert.ok(sitemap.includes('/servicos/eletricista/guarulhos/</loc>'));
  // UTM e identificadores de clique seguem para o formulário.
  assert.ok(fina.includes("'msclkid','fbclid'"));
});

console.log('conversao-pedidos: ok');
