// V11.96 — fluxo real do pedido no navegador, em ambiente seguro:
// o Supabase é substituído por um banco falso na própria página (nenhuma requisição sai para a internet),
// então nenhum pedido real é gravado e nenhum profissional é notificado.
// Uso: NODE_PATH=<pasta com playwright> node tests/conversao-browser.cjs   (depois de npm run build)
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'application/xml' };
const server = http.createServer((req, res) => {
  let p = new URL(req.url, 'http://local').pathname;
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); res.end(); return; } res.setHeader('Content-Type', types[path.extname(file)] || 'text/html; charset=utf-8'); res.end(data); });
});

// Cliente Supabase falso: qualquer cadeia .from().select().eq()… responde vazio; o pedido inserido volta com id.
const FAKE = `(() => {
  const UID = '11111111-2222-4333-8444-555555555555';
  const REQ = '4b6f1c2e-9a7d-4e21-8f3b-1c2d3e4f5a6b';
  window.__qfInserts = [];
  window.__qfInsertDelay = 600;
  const user = { id: UID, email: 'cliente@acesso.quemfaz.app.br', user_metadata: { qf_role: 'cliente', qf_nome: 'Teste' } };
  let session = null;
  const listeners = [];
  function builder(table) {
    const st = { table, op: 'select', row: null, single: false };
    const b = new Proxy(function () {}, {
      get(_, k) {
        if (k === 'then') {
          return (ok, ko) => {
            let data = st.single ? null : [];
            if (st.op === 'insert' && table === 'qf_chamados') {
              st.row.criado_em = st.row.criado_em || new Date().toISOString();
              window.__qfInserts.push(st.row);
              data = Object.assign({ id: REQ }, st.row);
              return new Promise(r => setTimeout(r, window.__qfInsertDelay)).then(() => ({ data, error: null })).then(ok, ko);
            }
            if (st.op === 'insert' && st.single) data = Object.assign({ id: 'x' }, st.row);
            if (st.op === 'select' && table === 'qf_chamados' && window.__qfInserts.length) {
              const rows = window.__qfInserts.map(r => Object.assign({ id: REQ, cliente_id: UID }, r));
              data = st.single ? rows[0] : rows;
            }
            if (table === 'qf_profiles' && st.single) data = { id: UID, nome: 'Teste', tipo: 'cliente', role: 'cliente', ativo: true, telefone: '11971532846' };
            return Promise.resolve({ data, error: null, count: 0 }).then(ok, ko);
          };
        }
        return (...a) => {
          if (k === 'insert' || k === 'upsert') { st.op = 'insert'; st.row = a[0]; }
          if (k === 'update') st.op = 'update';
          if (k === 'single' || k === 'maybeSingle') st.single = true;
          return b;
        };
      }
    });
    return b;
  }
  const channel = () => { const c = { on: () => c, subscribe: (cb) => { try { cb && cb('SUBSCRIBED'); } catch (_) {} return c; }, unsubscribe: () => Promise.resolve(), send: () => Promise.resolve() }; return c; };
  const client = {
    from: builder,
    rpc: () => builder('rpc'),
    channel, removeChannel: () => Promise.resolve(), removeAllChannels: () => Promise.resolve(), getChannels: () => [],
    functions: { invoke: (name) => Promise.resolve(name === 'quemfaz-cliente-rapido' ? { data: { ok: true, token_hash: 'abc', otp_type: 'magiclink' }, error: null } : { data: {}, error: null }) },
    storage: { from: () => ({ upload: () => Promise.resolve({ data: {}, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }),
      getUser: () => Promise.resolve({ data: { user: session ? user : null }, error: null }),
      onAuthStateChange: (cb) => { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      verifyOtp: () => { session = { access_token: 't', refresh_token: 'r', user }; listeners.forEach(cb => { try { cb('SIGNED_IN', session); } catch (_) {} }); return Promise.resolve({ data: { session, user }, error: null }); },
      signOut: () => { session = null; return Promise.resolve({ error: null }); },
      refreshSession: () => Promise.resolve({ data: { session }, error: null }),
      setSession: () => Promise.resolve({ data: { session }, error: null })
    }
  };
  const lib = { createClient: () => client };
  Object.defineProperty(window, 'supabase', { configurable: true, get: () => lib, set: () => {} });
})();`;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.QF_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const [width, height] of [[360, 740], [390, 844], [768, 1024], [1280, 900]]) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700 });
      const page = await context.newPage();
      const errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(FAKE);
      // Nada sai para a internet: anúncios, fontes e Supabase reais ficam bloqueados.
      await page.route(u => !u.href.startsWith(base), r => { external.push(new URL(r.request().url()).hostname); return r.abort(); });
      await page.goto(base + '/index.html?gclid=TESTE123&utm_source=google&utm_campaign=quemfaz_clientes_abc_teste');
      await page.waitForFunction(() => window.navigate && window.Screens && window.QFConversao);

      // Aviso de cookies: não aparece sobre a primeira tela; surge ao rolar, acima da barra inferior, e some ao escolher.
      await page.waitForTimeout(1500);
      assert.equal(await page.locator('#qf-consent').count(), 0, 'aviso na primeira tela em ' + width);
      await page.mouse.wheel(0, 900);
      await page.evaluate(() => { const e = document.scrollingElement; e.scrollTop = 900; e.dispatchEvent(new Event('scroll')); });
      await page.locator('#qf-consent').waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      const geo = await page.evaluate(() => { const b = document.querySelector('#qf-consent').getBoundingClientRect(); const n = document.querySelector('.qf-home-nav'); const r = n && getComputedStyle(n).display !== 'none' ? n.getBoundingClientRect() : null; return { bTop: b.top, bBottom: b.bottom, navTop: r ? r.top : innerHeight, h: innerHeight }; });
      assert.ok(geo.bBottom <= geo.navTop + 1 && geo.bBottom <= geo.h, 'aviso cobre a barra inferior em ' + width + ' ' + JSON.stringify(geo));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'sem rolagem lateral ' + width);
      await page.locator('#qf-consent [data-qf-consent="granted"]').click();
      await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
      assert.equal(await page.locator('#qf-consent').count(), 0);

      // Etapa 1 → evento pedido_iniciado e pedido_formulario_avancado.
      await page.locator('[data-landing-service-search]').fill('eletricista');
      const sug = page.locator('.qf-service-suggestion').first();
      if (await sug.isVisible().catch(() => false)) await sug.click();
      if (!(await page.locator('#cadastro-cliente-form').count())) await page.locator('[data-landing-service-form] [type="submit"]').click({ force: true });
      await page.locator('#cadastro-cliente-form').waitFor();
      const desc = page.locator('#cadastro-cliente-form [name="descricao"]');
      if (await desc.isVisible()) await desc.fill('Trocar dois disjuntores do quadro');
      else await page.locator('#cadastro-cliente-form [data-qf-opcao]').first().click();
      const cont = page.locator('#cadastro-cliente-form [data-qf-continuar]');
      if (await cont.isVisible()) await cont.click();
      await page.waitForFunction(() => document.querySelector('#cadastro-cliente-form').getAttribute('data-qf-etapa') === '2');
      let evs = await page.evaluate(() => window.dataLayer.filter(e => e && e.event && /^pedido_/.test(e.event)).map(e => e.event));
      assert.deepEqual(evs, ['pedido_iniciado', 'pedido_formulario_avancado'], 'eventos de etapa ' + width);

      // Local → escolhas → contato.
      await page.locator('#cadastro-cliente-form [name="cidade"]').fill('Santo André');
      await page.locator('#cadastro-cliente-form [name="uf"]').fill('SP').catch(() => {});
      const bairro = page.locator('#cadastro-cliente-form [name="bairro"]');
      if (await bairro.count()) await bairro.fill('Centro');
      await page.locator('#cadastro-cliente-form [data-qf-sub-box="a"] [data-qf-sub-ir="b"]').click();
      await page.waitForFunction(() => document.querySelector('#cadastro-cliente-form').getAttribute('data-qf-sub') === 'b');
      const prazo = page.locator('#cadastro-cliente-form [data-qf-sub-box="b"] .qf-prazo__opt').first();
      if (await prazo.count()) await prazo.click();
      await page.locator('#cadastro-cliente-form [data-qf-sub-box="b"] [data-qf-sub-ir="c"]').click();
      await page.waitForFunction(() => document.querySelector('#cadastro-cliente-form').getAttribute('data-qf-sub') === 'c');
      // Botões de toque com altura mínima de 44px.
      const tiny = await page.locator('#cadastro-cliente-form button:visible').evaluateAll(bs => bs.filter(b => b.getBoundingClientRect().height < 40).map(b => b.textContent.trim()));
      assert.deepEqual(tiny, [], 'botões pequenos demais em ' + width);
      await page.locator('#cadastro-cliente-form [name="nome"]').fill('Maria Teste');
      await page.locator('#cadastro-cliente-form [name="telefone"]').fill('(11) 97153-2846');

      // Antes do banco responder: nada de pedido_publicado. Clique duplo não cria dois pedidos.
      const submit = page.locator('#cadastro-cliente-form .qf-request-submit');
      await submit.click();
      await submit.click({ force: true, timeout: 1000 }).catch(() => {});
      evs = await page.evaluate(() => window.dataLayer.filter(e => e && e.event === 'pedido_publicado').length);
      assert.equal(evs, 0, 'pedido_publicado antes da confirmação do banco');
      await page.waitForFunction(() => window.dataLayer.some(e => e && e.event === 'pedido_publicado'), null, { timeout: 15000 }).catch(async (e) => {
        const dbg = await page.evaluate(() => ({ hash: location.hash, toast: [...document.querySelectorAll('.toast, [class*=toast]')].map(t => t.textContent).join(' | '), inserts: (window.__qfInserts || []).length, invalid: [...document.querySelectorAll('[data-qf-validation-for]')].map(x => x.textContent), sub: document.querySelector('#cadastro-cliente-form') && document.querySelector('#cadastro-cliente-form').getAttribute('data-qf-sub') }));
        throw new Error('sem pedido_publicado: ' + JSON.stringify(dbg) + ' ' + JSON.stringify(errors));
      });
      const pub = await page.evaluate(() => ({ inserts: window.__qfInserts.length, ev: window.dataLayer.filter(e => e && e.event === 'pedido_publicado'), origem: window.__qfInserts[0] && window.__qfInserts[0].marketing_origem, gtag: window.dataLayer.filter(a => a && a[0] === 'event' && a[1] === 'conversion').length }));
      assert.equal(pub.inserts, 1, 'um pedido só');
      assert.equal(pub.ev.length, 1);
      assert.equal(pub.ev[0].transaction_id, '4b6f1c2e-9a7d-4e21-8f3b-1c2d3e4f5a6b');
      assert.equal(pub.ev[0].categoria, 'cat_eletricista');
      assert.equal(pub.origem.click_id, 'TESTE123', 'gclid gravado no pedido');
      assert.equal(pub.origem.click_type, 'gclid');
      assert.equal(pub.gtag, 1, 'uma conversão do Google Ads');
      const dl = JSON.stringify(await page.evaluate(() => window.dataLayer));
      for (const pii of ['Maria Teste', '97153', 'Centro', 'disjuntores']) assert.ok(!dl.includes(pii), 'dado pessoal na camada de dados: ' + pii);

      // Recarregar a página do pedido não repete a conversão.
      await page.reload();
      await page.waitForFunction(() => window.QFClientAcquisition);
      await page.evaluate(() => window.QFClientAcquisition.published({ id: '4b6f1c2e-9a7d-4e21-8f3b-1c2d3e4f5a6b' }, 'cat_eletricista'));
      assert.equal(await page.evaluate(() => window.dataLayer.filter(e => e && e.event === 'pedido_publicado').length), 0, 'conversão repetida após recarregar');

      if (width === 390) await page.screenshot({ path: path.join(process.env.QF_SHOTS || '/tmp', 'qf-pedido-' + width + '.png') });
      assert.deepEqual(errors, [], 'erros de JavaScript em ' + width);
      results.push('PASS ' + width + 'px: aviso de cookies, etapas, eventos, clique duplo, publicação só após o banco, gclid no pedido, sem dado pessoal, sem repetir conversão.');
      await context.close();
    }

    // Recusa de cookies: pedido continua funcionando, mas nada vai para anúncios.
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.addInitScript(FAKE);
    await page.route(u => !u.href.startsWith(base), r => r.abort());
    await page.goto(base + '/index.html');
    await page.waitForFunction(() => window.QFConversao);
    await page.evaluate(() => window.QFConversao.mostrarAviso());
    await page.locator('#qf-consent [data-qf-consent="denied"]').click();
    const st = await page.evaluate(() => ({ c: window.QFConversao.consentimento(), upd: window.dataLayer.some(a => a && a[0] === 'consent' && a[1] === 'update' && a[2].ad_storage === 'denied') }));
    assert.equal(st.c, 'denied'); assert.ok(st.upd, 'Consent Mode atualizado para negado');
    await page.reload(); await page.waitForFunction(() => window.QFConversao);
    assert.equal(await page.locator('#qf-consent').count(), 0, 'aviso não volta depois da escolha');
    assert.ok(await page.evaluate(() => window.dataLayer.some(a => a && a[0] === 'consent' && a[1] === 'default' && a[2].ad_storage === 'denied')), 'recusa respeitada no carregamento');
    results.push('PASS recusa de cookies: Consent Mode negado e lembrado após recarregar.');
    await context.close();

    // Página do ABC no celular: CTA leva ao formulário com o serviço e mantém o gclid.
    const ctx2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const p2 = await ctx2.newPage();
    await p2.addInitScript(FAKE);
    await p2.route(u => !u.href.startsWith(base), r => r.abort());
    await p2.goto(base + '/servicos/encanador/abc/?gclid=XYZ789&utm_source=google');
    assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'guia ABC sem rolagem lateral');
    const href = await p2.locator('a.cta').first().getAttribute('href');
    assert.ok(href.includes('servico=cat_encanador') && href.includes('gclid=XYZ789') && href.endsWith('#/auth/cliente/cadastro'), href);
    await p2.locator('a.cta').first().click();
    await p2.waitForFunction(() => window.QFMarketingTouch && document.querySelector('#cadastro-cliente-form'), null, { timeout: 15000 });
    assert.equal(await p2.evaluate(() => window.QFMarketingTouch.click_id), 'XYZ789');
    await p2.screenshot({ path: path.join(process.env.QF_SHOTS || '/tmp', 'qf-abc-form-360.png') });
    results.push('PASS guia ABC 360px: sem rolagem lateral; botão abre o formulário de encanador mantendo o gclid.');
    await ctx2.close();
    results.forEach(r => console.log(r));
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
