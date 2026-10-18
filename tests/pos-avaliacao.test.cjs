const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../qf-pos-avaliacao.js');
const load = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const DIA = 86400000;

test('link do Android é o oficial já configurado no projeto (play-links.js) e só aceita https da Play Store', () => {
  const cfg = new Function('window', load('play-links.js').split('(function () {')[0] + '; return window.QF_PLAY;')({});
  assert.equal(P.linkPlay(cfg), cfg.LINK_DA_LOJA);
  assert.equal(P.linkPlay(cfg), 'https://play.google.com/store/apps/details?id=br.app.quemfaz');
  assert.equal(P.linkPlay({ LINK_DA_LOJA: 'http://evil.example/x' }), P.PLAY_PADRAO);
  assert.equal(P.linkPlay({ LINK_DA_LOJA: 'javascript:alert(1)' }), P.PLAY_PADRAO);
  assert.equal(P.linkPlay(null), P.PLAY_PADRAO);
});

test('convite escondido quando o app já está instalado (PWA, APK, marca salva)', () => {
  assert.equal(P.deveMostrarConvite({}), true);
  assert.equal(P.deveMostrarConvite({ standalone: true }), false);
  assert.equal(P.deveMostrarConvite({ nativo: true }), false);
  assert.equal(P.deveMostrarConvite({ marcadoInstalado: true }), false);
  assert.equal(P.deveMostrarConvite({ plataformaSalva: 'android' }), false);
});

test('não insiste: dispensou há menos de 30 dias não mostra; depois volta', () => {
  const agora = Date.UTC(2026, 9, 18);
  assert.equal(P.deveMostrarConvite({ dispensadoEm: agora - 2 * DIA, agora }), false);
  assert.equal(P.deveMostrarConvite({ dispensadoEm: agora - 29 * DIA, agora }), false);
  assert.equal(P.deveMostrarConvite({ dispensadoEm: agora - 31 * DIA, agora }), true);
  assert.equal(P.deveMostrarConvite({ dispensadoEm: null, agora }), true);
});

test('modo de instalação: Android→Play, navegador com prompt→PWA, iPhone→instrução, resto→nenhum', () => {
  assert.equal(P.modoInstalar({ android: true, promptPwa: true }), 'play');
  assert.equal(P.modoInstalar({ promptPwa: true }), 'pwa');
  assert.equal(P.modoInstalar({ ios: true }), 'ios');
  assert.equal(P.modoInstalar({}), 'nenhum');
});

test('tela de sucesso tem o texto pedido e os dois botões', () => {
  const h = P.html({ resultado: 'concluido', convite: true, modo: 'play', playUrl: 'https://play.google.com/store/apps/details?id=br.app.quemfaz', novoPedido: '/' });
  assert.ok(h.includes('Serviço finalizado com sucesso!'));
  assert.ok(h.includes('Obrigado por avaliar o profissional. Tenha o Quem Faz sempre à mão para quando precisar de outro serviço.'));
  assert.ok(h.includes('Instalar aplicativo grátis'));
  assert.ok(h.includes('href="https://play.google.com/store/apps/details?id=br.app.quemfaz"'));
  assert.ok(h.includes('Solicitar outro serviço') && h.includes('data-qf-novo-pedido'));
  assert.ok(h.includes('Agora não'));
});

test('sem convite: some o botão de instalar e o "Agora não", mas o novo pedido fica', () => {
  const h = P.html({ resultado: 'concluido', convite: false, modo: 'play', novoPedido: '/' });
  assert.ok(!h.includes('data-qf-instalar') && !h.includes('Agora não'));
  assert.ok(h.includes('Solicitar outro serviço'));
});

test('serviço com problema/não realizado não diz "finalizado com sucesso" nem convida a instalar', () => {
  const h = P.html({ resultado: 'com_problema', convite: true, modo: 'play', novoPedido: '/' });
  assert.ok(!h.includes('finalizado com sucesso') && !h.includes('data-qf-instalar'));
  assert.ok(h.includes('Solicitar outro serviço'));
});

test('novo pedido abre o formulário normal (raiz do site), sem login nem instalação, sem categoria fixa', () => {
  assert.equal(P.novoPedidoUrl('https://quemfazservico.com.br/'), 'https://quemfazservico.com.br/');
  const h = P.html({ novoPedido: '/' });
  assert.ok(!/cat_|categoria|pintor/i.test(h));
  assert.ok(!/auth|login|cadastro/i.test(P.novoPedidoUrl('https://x.br')));
});

test('HTML escapa a URL recebida', () => {
  const h = P.html({ convite: true, modo: 'play', playUrl: 'https://play.google.com/"><script>x</script>' });
  assert.ok(!h.includes('<script>'));
});

test('páginas de avaliação usam a tela nova e o módulo carrega antes de ser usado', () => {
  for (const f of ['confirmar-servico.html', 'avaliar.html']) {
    const h = load(f);
    assert.match(h, /qf-pos-avaliacao\.js/, f);
    assert.match(h, /play-links\.js/, f);
    assert.match(h, /QFPosAvaliacao\.mostrar/, f);
    assert.match(h, /rel="manifest"/, f);
    assert.ok(h.indexOf('qf-pos-avaliacao.js') < h.indexOf('QFPosAvaliacao.mostrar'), f);
  }
});

test('QR da carteirinha: cliente logado com pendência vai para a confirmação do pedido; sem conta mantém a avaliação rápida', () => {
  const h = load('avaliar.html');
  assert.match(h, /qf_cliente_conclusoes_pendentes/);
  assert.match(h, /p_carteirinha:token/);
  assert.match(h, /confirmar-servico\.html#p=/);
  assert.match(h, /cfg\.data\.ativo!==true\)return/); // atrás da chave
  assert.match(h, /qf_avaliar_carteirinha/);          // fluxo anterior preservado
});

test('o botão do profissional se chama "Solicitar finalização do serviço"', () => {
  assert.match(load('qf-valor-definido.js'), /Solicitar finalização do serviço/);
});

test('mostrar() desenha a tela no navegador (ambiente simulado) e respeita convite/dispensa', () => {
  const store = {};
  const g = globalThis;
  const saved = { window: g.window, document: g.document, navigator: Object.getOwnPropertyDescriptor(g, 'navigator'), localStorage: Object.getOwnPropertyDescriptor(g, 'localStorage'), location: g.location, QF_PLAY: g.QF_PLAY };
  const els = {};
  g.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild() {} } };
  Object.defineProperty(g, 'navigator', { value: { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' }, configurable: true });
  Object.defineProperty(g, 'localStorage', { value: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, configurable: true });
  g.location = { origin: 'https://quemfazservico.com.br' };
  g.QF_PLAY = { LINK_DA_LOJA: 'https://play.google.com/store/apps/details?id=br.app.quemfaz' };
  try {
    const alvo = { innerHTML: '', querySelector: () => null };
    P.mostrar(alvo, 'concluido');
    assert.ok(alvo.innerHTML.includes('Instalar aplicativo grátis'));
    assert.ok(alvo.innerHTML.includes('play.google.com/store/apps/details?id=br.app.quemfaz'));
    store.qf_pwa_installed = '1';
    P.mostrar(alvo, 'concluido');
    assert.ok(!alvo.innerHTML.includes('Instalar aplicativo grátis'));
    assert.ok(alvo.innerHTML.includes('Solicitar outro serviço'));
    delete store.qf_pwa_installed; store[P.CHAVE_DISPENSA] = String(Date.now() - DIA);
    P.mostrar(alvo, 'concluido');
    assert.ok(!alvo.innerHTML.includes('Instalar aplicativo grátis'));
  } finally {
    g.document = saved.document; g.location = saved.location; g.QF_PLAY = saved.QF_PLAY;
    if (saved.navigator) Object.defineProperty(g, 'navigator', saved.navigator);
    if (saved.localStorage) Object.defineProperty(g, 'localStorage', saved.localStorage); else delete g.localStorage;
  }
});
