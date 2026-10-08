// Verifica a barra aprovada sem enviar pedidos ou alterar dados reais.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://local').pathname);
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.webp') ? 'image/webp' : 'text/html');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.QF_CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  try {
    const context = await browser.newContext({serviceWorkers: 'block'});
    for (const width of [320, 390, 430, 768, 1440]) {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({width, height: 950});
      await page.route('https://**/*', route => route.abort());
      await page.goto('http://127.0.0.1:' + server.address().port + '/index.html?demo=1');
      await page.waitForFunction(() => window.navigate && window.Screens);
      const bar = page.locator('.qf-landing-topbar');
      await bar.waitFor();
      const boxes = await bar.locator(':scope > *').evaluateAll(nodes => nodes.map(node => {
        const r = node.getBoundingClientRect();
        return {name: node.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom};
      }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'Controles sobrepostos em ' + width);
      }
      const brand = await bar.locator('.qf-brand-words').evaluate(node => {
        const range = document.createRange(); range.selectNodeContents(node.firstChild);
        const quem = range.getBoundingClientRect(); range.selectNodeContents(node.querySelector('span'));
        const faz = range.getBoundingClientRect();
        return {quemTop: quem.top, fazTop: faz.top, quemRight: quem.right, fazLeft: faz.left};
      });
      assert.ok(Math.abs(brand.quemTop - brand.fazTop) < 2 && brand.quemRight <= brand.fazLeft, 'Logo horizontal em ' + width);
      if (width < 900) {
        const rows = Object.fromEntries(boxes.map(box => [box.name, box.top]));
        assert.ok(rows['qf-launch-mini'] > rows['qf-landing-brand']);
        assert.ok(rows['qf-home-prof'] > rows['btn btn--primary qf-landing-login']);
      }
      await page.evaluate(() => window.scrollTo(0, 400));
      assert.equal(await bar.evaluate(node => Math.round(node.getBoundingClientRect().top)), 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      for (const target of ['/auth/profissional/login', '/anuncie']) {
        await bar.locator('.qf-home-prof summary').click();
        const menu = bar.locator('.qf-home-prof-menu');
        const rect = await menu.boundingBox();
        assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, 'Menu dentro da tela em ' + width);
        await menu.locator('[data-nav="' + target + '"]').click();
        await page.waitForFunction(target => location.hash === '#' + target, target);
        await page.locator('[data-nav="/"]').first().click(); await bar.waitFor();
      }
      await bar.locator('.qf-landing-login').click();
      await page.locator('#qf-login-cliente').click();
      await page.locator('#login-form').waitFor();
      await page.locator('[data-nav="/"]').first().click(); await bar.waitFor();
      await page.reload(); await bar.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      if (width === 390 || width === 1440) await page.screenshot({path: path.join(process.env.QF_SCREENSHOT_DIR || '/tmp', 'quemfaz-header-' + width + '.png'), fullPage: true});
      await page.close();
      console.log('PASS ' + width + 'px: logo horizontal, barra fixa, menu, profissional, empresa, entrar, voltar e recarregar.');
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
