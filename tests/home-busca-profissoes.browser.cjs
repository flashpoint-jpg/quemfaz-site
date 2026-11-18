// Verifica o novo campo de busca sem publicar pedidos reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../dist');
const server = http.createServer((req, res) => {
  const target = path.join(root, new URL(req.url, 'http://local').pathname);
  if (!target.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : target.endsWith('.webp') ? 'image/webp' : 'text/html');
    res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({executablePath: process.env.QF_CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    for (const width of [390, 1440]) {
      const page = await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
      await page.route('https://**/*', route => route.abort());
      await page.goto('http://127.0.0.1:' + server.address().port + '/index.html?demo=1');
      await page.locator('.qf-approved-search').waitFor();
      assert.equal(await page.locator('[data-landing-service-form]').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('[data-landing-service-search]').fill('montador');
      await page.locator('[data-landing-search-cat]').first().waitFor();
      assert.match(await page.locator('[data-landing-service-suggestions]').innerText(), /Montador de móveis/i);
      await page.locator('[data-landing-show-all]').click();
      assert.equal(await page.locator('[data-landing-all-list]').isVisible(), true);
      await page.locator('[data-landing-service-form] [type="submit"]').click();
      await page.waitForFunction(() => location.hash.includes('/auth/cliente/cadastro'));
      await page.close();
      console.log('PASS busca universal ' + width + 'px');
    }
  } finally { await browser.close(); server.close(); }
})().catch(err => { console.error(err); server.close(); process.exitCode = 1; });
