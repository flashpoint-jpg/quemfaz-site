// SEO pós-build (14/10/2026):
// 1) Ícone (logo) do QuemFaz em todas as páginas públicas, para o Google e o navegador.
// 2) Página /servicos/ com todos os serviços e cidades (links que o Google segue).
// 3) Cada página de serviço ganha a lista "por cidade"; o logo do topo volta para a home.
// 4) Títulos das páginas locais com "perto de você" (busca "eletricista perto de mim").
// Não altera a aplicação nem a home.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dist');
const domain = 'https://quemfazservico.com.br';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const generator = fs.readFileSync(path.join(__dirname, 'generate-seo-pages.cjs'), 'utf8');
const services = JSON.parse(generator.match(/const services=(\[[^\n]+\]);\s*const cities=/)[1]);
const cities = Function('return ' + generator.match(/const cities=(\[[^\n]+?\]);/)[1])();

const ICON_TAGS = '<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png">' +
  '<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
const BRAND = '<div class="b">Quem<span class="o">Faz</span></div>';
const BRAND_LINK = '<a class="b" href="/" style="display:inline-block;color:inherit;text-decoration:none" aria-label="QuemFaz - página inicial">Quem<span class="o">Faz</span></a>';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'index.html' && dir !== root) out.push(p);
  }
  return out;
}

const cityLinksFor = s => cities
  .filter(c => fs.existsSync(path.join(root, 'servicos', s.slug, c.slug, 'index.html')))
  .map(c => '<li><a href="/servicos/' + s.slug + '/' + c.slug + '/">' + esc(s.nome) + ' em ' + esc(c.nome) + '</a></li>')
  .join('');

let pages = 0, titles = 0, hubs = 0;
for (const file of walk(root)) {
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  if (!/rel="icon"/.test(html) && html.includes('</head>')) html = html.replace('</head>', ICON_TAGS + '</head>');
  if (html.includes(BRAND)) html = html.replace(BRAND, BRAND_LINK);

  const rel = path.relative(root, file).split(path.sep);
  // Página local: servicos/<servico>/<cidade>/index.html
  if (rel[0] === 'servicos' && rel.length === 4) {
    html = html.replace(/<title>([^<|]+?) em ([^<|]+?) \| Quem Faz<\/title>/, (m, s, c) => {
      titles++;
      return '<title>' + s + ' em ' + c + ' perto de você | Quem Faz</title>';
    });
  }
  // Página do serviço: servicos/<servico>/index.html
  if (rel[0] === 'servicos' && rel.length === 3 && !html.includes('data-qf-city-list')) {
    const s = services.find(x => x.slug === rel[1]);
    const links = s && cityLinksFor(s);
    if (links) {
      html = html.replace('</main>', '<section data-qf-city-list><h2>' + esc(s.nome) + ' por cidade</h2><ul>' + links +
        '</ul><p><a href="/servicos/">Ver todos os serviços</a></p></section></main>');
      hubs++;
    }
  }
  if (html !== before) { fs.writeFileSync(file, html); pages++; }
}

// Página /servicos/ — índice de todos os serviços e cidades.
const serviceList = services
  .filter(s => fs.existsSync(path.join(root, 'servicos', s.slug, 'index.html')))
  .map(s => '<li><a href="/servicos/' + s.slug + '/">' + esc(s.nome) + '</a></li>').join('');
const cityBlocks = cities.map(c => {
  const items = services
    .filter(s => fs.existsSync(path.join(root, 'servicos', s.slug, c.slug, 'index.html')))
    .slice(0, 12)
    .map(s => '<li><a href="/servicos/' + s.slug + '/' + c.slug + '/">' + esc(s.nome) + '</a></li>').join('');
  return items ? '<h3>' + esc(c.nome) + ' - ' + c.uf + '</h3><ul class="g">' + items + '</ul>' : '';
}).join('');
const desc = 'Encontre eletricista, encanador, montador, diarista e mais de 60 serviços perto de você. Peça grátis no Quem Faz e receba contatos de profissionais da sua região.';
const schema = {
  '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Serviços do Quem Faz', url: domain + '/servicos/', description: desc,
  isPartOf: { '@type': 'WebSite', name: 'Quem Faz', url: domain + '/' },
  publisher: { '@type': 'Organization', name: 'Quem Faz', url: domain + '/', logo: domain + '/quemfaz.png' }
};
const hub = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Profissionais perto de você: todos os serviços | Quem Faz</title><meta name="description" content="' + esc(desc) + '">' +
  '<link rel="canonical" href="' + domain + '/servicos/"><meta name="robots" content="index,follow">' + ICON_TAGS +
  '<script type="application/ld+json">' + JSON.stringify(schema) + '</' + 'script>' +
  '<style>body{font-family:Arial,sans-serif;margin:0;background:#f6f8fb;color:#0b1d3a}.w{max-width:860px;margin:auto;padding:38px 22px}.b{font-weight:800;font-size:24px}.o{color:#f97316}h1{font-size:36px;line-height:1.12;margin:34px 0 14px}h2{margin-top:34px}p,li{font-size:17px;line-height:1.65}a{color:#1458cc}.g{columns:2;padding-left:18px}@media(min-width:700px){.g{columns:3}}.cta{display:inline-block;margin:12px 0 18px;padding:16px 22px;border-radius:12px;background:#f97316;color:#fff;text-decoration:none;font-weight:800}</style></head>' +
  '<body><main class="w">' + BRAND_LINK + '<h1>Profissionais perto de você</h1><p>Escolha o serviço e a cidade. No Quem Faz, você pede grátis, sem cadastro, e profissionais da sua região chamam você no WhatsApp.</p>' +
  '<a class="cta" href="/">Pedir grátis</a><h2>Todos os serviços</h2><ul class="g">' + serviceList + '</ul><h2>Serviços por cidade</h2>' + cityBlocks + '</main></body></html>';
fs.mkdirSync(path.join(root, 'servicos'), { recursive: true });
fs.writeFileSync(path.join(root, 'servicos', 'index.html'), hub);

const smPath = path.join(root, 'sitemap.xml');
let sm = fs.readFileSync(smPath, 'utf8');
if (!sm.includes('<loc>' + domain + '/servicos/</loc>')) {
  sm = sm.replace('<url><loc>' + domain + '/</loc></url>', '<url><loc>' + domain + '/</loc></url>\n<url><loc>' + domain + '/servicos/</loc></url>');
  if (!sm.includes(domain + '/servicos/</loc>')) throw Error('Sitemap: não foi possível incluir /servicos/');
  fs.writeFileSync(smPath, sm);
}
console.log('SEO ícones/índice: ' + pages + ' páginas com logo, ' + titles + ' títulos "perto de você", ' + hubs + ' serviços com lista de cidades e /servicos/ criado.');
