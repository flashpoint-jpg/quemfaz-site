// Use the final sitemap, after consolidation, as the source for navigation.
// Generic local pages keep their intentional noindex; only discovery links change.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dist');
const origin = 'https://quemfazservico.com.br';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const urls = [...fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const pages = urls.map(url => {
  const route = new URL(url).pathname;
  const file = path.join(root, route, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const head = html.split('</head>')[0];
  if (/name="robots" content="[^"]*noindex/i.test(head) || !head.includes('rel="canonical" href="' + url + '"')) {
    throw Error('Navigation cannot promote excluded URL: ' + url);
  }
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) throw Error('Missing heading: ' + url);
  return { route, file, label: heading[1].replace(/<[^>]*>/g, '').trim() };
});
const links = rows => rows.map(p => '<li><a href="' + esc(p.route) + '">' + p.label + '</a></li>').join('');
let updated = 0;
for (const page of pages) {
  const service = /^\/servicos\/([^/]+)\/$/.exec(page.route);
  if (!service) continue;
  const local = pages.filter(p => p.route.startsWith(page.route) && p.route !== page.route);
  let html = fs.readFileSync(page.file, 'utf8');
  html = html.replace(/<section data-qf-city-list>[\s\S]*?<\/section>/g, '');
  if (local.length) html = html.replace('</main>', '<section data-qf-city-list><h2>Guias e cidades</h2><ul>' + links(local) + '</ul><p><a href="/servicos/">Ver todos os serviços</a></p></section></main>');
  fs.writeFileSync(page.file, html);
  updated++;
}
const hub = path.join(root, 'servicos', 'index.html');
let html = fs.readFileSync(hub, 'utf8');
const marker = '<h2>Serviços por cidade</h2>';
if (!html.includes(marker)) throw Error('Service directory marker missing');
// Include complementary service guides as well as the editorial city pages.
const local = pages.filter(p => p.route !== '/' && p.route !== '/servicos/' && !/^\/servicos\/[^/]+\/$/.test(p.route));
html = html.replace(/<h2>Serviços por cidade<\/h2>[\s\S]*?<\/main>/, '<section data-qf-index-guides><h2>Guias de serviços e cidades</h2><ul class="g">' + links(local) + '</ul></section></main>');
fs.writeFileSync(hub, html);
console.log('SEO navigation: ' + updated + ' service directories revised; ' + local.length + ' canonical guides linked.');
