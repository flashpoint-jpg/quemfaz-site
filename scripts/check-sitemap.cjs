const fs = require('node:fs');
const path = require('node:path');
const xml = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sitemap.xml'), 'utf8');
const domain = 'https://quemfazservico.com.br';
if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')) throw Error('Sitemap: invalid XML declaration');
if (!xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') || !xml.trimEnd().endsWith('</urlset>')) throw Error('Sitemap: missing urlset');
const urls = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>\s*)?<\/url>/g)].map(m => m[1]);
const count = (xml.match(/<url>/g) || []).length;
if (urls.length !== count || urls.length < 50) throw Error('Sitemap: malformed entries');
if (new Set(urls).size !== urls.length) throw Error('Sitemap: duplicate URLs');
for (const url of urls) {
  const parsed = new URL(url);
  if (parsed.origin !== domain || !parsed.pathname.startsWith('/') || parsed.search || parsed.hash) throw Error('Sitemap: invalid URL ' + url);
}
// Valida o sitemap FINAL: não anunciar páginas de serviço ausentes, bloqueadas ou com canonical divergente.
for (const url of urls) {
  const pathname = new URL(url).pathname;
  if (!pathname.startsWith('/servicos/')) continue;
  const file = path.join(__dirname, '..', 'dist', pathname, 'index.html');
  if (!fs.existsSync(file)) throw Error('Sitemap: missing service page ' + url);
  const html = fs.readFileSync(file, 'utf8');
  const head = html.split(/<\/head>/i)[0];
  if (/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(head)) throw Error('Sitemap: noindex service page ' + url);
  if (!head.includes('rel="canonical" href="' + url + '"')) throw Error('Sitemap: canonical mismatch ' + url);
}
if (Buffer.byteLength(xml) > 50 * 1024 * 1024) throw Error('Sitemap exceeds 50 MB');
console.log('Sitemap checked: ' + urls.length + ' unique URLs, ' + Buffer.byteLength(xml) + ' bytes.');
