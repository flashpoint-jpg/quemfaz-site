const fs = require('node:fs');
const path = require('node:path');
const xml = fs.readFileSync(path.join(__dirname, '..', 'dist', 'sitemap.xml'), 'utf8');
const domain = 'https://quemfazservico.com.br';
if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')) throw Error('Sitemap: invalid XML declaration');
if (!xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') || !xml.trimEnd().endsWith('</urlset>')) throw Error('Sitemap: missing urlset');
const urls = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<\/url>/g)].map(m => m[1]);
const count = (xml.match(/<url>/g) || []).length;
if (urls.length !== count || urls.length < 50) throw Error('Sitemap: malformed entries');
if (new Set(urls).size !== urls.length) throw Error('Sitemap: duplicate URLs');
for (const url of urls) {
  const parsed = new URL(url);
  if (parsed.origin !== domain || !parsed.pathname.startsWith('/') || parsed.search || parsed.hash) throw Error('Sitemap: invalid URL ' + url);
}
if (Buffer.byteLength(xml) > 50 * 1024 * 1024) throw Error('Sitemap exceeds 50 MB');
console.log('Sitemap checked: ' + urls.length + ' unique URLs, ' + Buffer.byteLength(xml) + ' bytes.');
