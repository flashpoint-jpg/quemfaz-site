// Última etapa: mantém URLs canônicas e metadados consistentes sem alterar o conteúdo visual.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isPriorityRoute, legacyGuideRoots } = require('./seo-index-policy.cjs');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const origin = 'https://quemfazservico.com.br';
const sitemapFile = path.join(out, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapFile, 'utf8');
const manifestFile = path.join(out, 'seo-205-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const robotsTag = '<meta name="robots" content="noindex,follow">';
const robotsPattern = /<meta\s+name="robots"[^>]*>/i;

function preventIndexing(file) {
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes(robotsTag)) return;
  const updated = robotsPattern.test(html)
    ? html.replace(robotsPattern, robotsTag)
    : html.replace('</head>', robotsTag + '</head>');
  fs.writeFileSync(file, updated);
}

for (const page of manifest.pages) {
  if (!page.index || isPriorityRoute(page.url)) continue;
  page.index = false;
  preventIndexing(path.join(out, page.url, 'index.html'));
}
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

function markLegacyGuides(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) markLegacyGuides(file);
    else if (entry.name === 'index.html') preventIndexing(file);
  }
}
for (const slug of legacyGuideRoots) markLegacyGuides(path.join(out, slug));

sitemap = sitemap.replace(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g,
  (entry, url) => isPriorityRoute(new URL(url).pathname) ? entry : '');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
let ogAdded = 0;
for (const url of urls) {
  const parsed = new URL(url);
  if (parsed.origin !== origin || parsed.search || parsed.hash) throw Error('URL não canônica: ' + url);
  const file = path.join(out, parsed.pathname, 'index.html');
  if (!fs.existsSync(file)) throw Error('URL do sitemap sem arquivo: ' + url);
  let html = fs.readFileSync(file, 'utf8');
  const head = html.split(/<\/head>/i)[0];
  if (!head.includes('rel="canonical" href="' + url + '"')) throw Error('Canonical divergente: ' + url);
  if (/<meta\s+name="robots"[^>]*content="[^"]*noindex/i.test(head)) throw Error('Noindex no sitemap: ' + url);
  if (/data-qf-direct-organic|<meta\b[^>]*http-equiv="refresh"/i.test(head)) throw Error('Redirecionamento no sitemap: ' + url);
  if (!/<title>[^<]+<\/title>/.test(head) || !/<h1\b/i.test(html)) throw Error('Conteúdo HTML ausente: ' + url);
  if (!/<meta\s+property="og:url"/.test(head)) {
    html = html.replace('</head>', '<meta property="og:url" content="' + url + '"></head>');
    fs.writeFileSync(file, html);
    ogAdded++;
  } else if (!head.includes('property="og:url" content="' + url + '"')) {
    throw Error('og:url divergente: ' + url);
  }
}
// O build gera novamente essas páginas a partir do commit do site.
// lastmod utiliza a data real do commit que produziu a versão, nunca a hora do servidor.
let lastmod = process.env.QF_SEO_SOURCE_DATE || '';
if (!lastmod) {
  try { lastmod = execFileSync('git', ['log', '-1', '--format=%cs'], {cwd: root, encoding: 'utf8'}).trim(); }
  catch (_) { lastmod = '2026-11-14'; } // Data conhecida desta revisão, caso o deploy não inclua .git.
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) throw Error('Data do commit inválida: ' + lastmod);
sitemap = sitemap.replace(/<url>\s*<loc>([^<]+)<\/loc>\s*(?:<lastmod>[^<]*<\/lastmod>\s*)?<\/url>/g,
  (_, url) => '<url><loc>' + url + '</loc><lastmod>' + lastmod + '</lastmod></url>');
fs.writeFileSync(sitemapFile, sitemap);
console.log('SEO técnico: ' + urls.length + ' URLs verificadas, ' + ogAdded + ' og:url inseridos, lastmod do commit ' + lastmod + '.');
