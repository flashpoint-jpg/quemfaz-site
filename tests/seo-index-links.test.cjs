const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '../dist');
const origin = 'https://quemfazservico.com.br';
const urls = [...fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const read = route => fs.readFileSync(path.join(root, route, 'index.html'), 'utf8');
test('service directory gives every sitemap page a direct discovery link', () => {
  const doc = new JSDOM(read('/servicos/'), { url: origin + '/servicos/' }).window.document;
  const links = new Set([...doc.querySelectorAll('a[href]')].map(a => a.href));
  for (const url of urls) if (url !== origin + '/servicos/') assert.ok(links.has(url), url);
});
test('service directories never promote noindex or alternate local pages', () => {
  for (const url of urls.filter(u => /\/servicos\/(?:[^/]+\/)?$/.test(u))) {
    const doc = new JSDOM(read(new URL(url).pathname), { url }).window.document;
    for (const a of doc.querySelectorAll('a[href]')) {
      const dest = new URL(a.href);
      if (dest.origin !== origin || dest.search || dest.hash) continue;
      const file = path.join(root, dest.pathname, 'index.html');
      if (!fs.existsSync(file) || !dest.pathname.startsWith('/servicos/')) continue;
      const head = read(dest.pathname).split('</head>')[0];
      assert.doesNotMatch(head, /name="robots" content="[^"]*noindex/i, a.href);
      assert.ok(head.includes('rel="canonical" href="' + a.href + '"'), a.href);
    }
  }
});
