// Última etapa editorial: prevalece sobre os geradores legados, antes de validar o sitemap.
// Altera somente HTML público de serviços; preserva links e scripts dos formulários.
const fs = require('node:fs');
const path = require('node:path');
const { intents, aliases } = require('./seo-intent-content.cjs');
const cities = require('./seo-city-content.cjs');
const root = path.join(__dirname, '..', 'dist');
const domain = 'https://quemfazservico.com.br';
const generator = fs.readFileSync(path.join(__dirname, 'generate-seo-pages.cjs'), 'utf8');
const services = JSON.parse(generator.match(/const services=(\[[^\n]+\]);\s*const cities=/)[1]);
const catalog = Object.fromEntries(services.map(s => [s.slug, s]));
catalog['limpeza-de-sofa'] = { nome: 'Limpeza de sofá', id: 'cat_limpeza_estofados' };
catalog['lavagem-de-tapetes'] = { nome: 'Lavagem de tapetes', id: 'cat_limpeza_estofados' };
catalog['limpeza-de-colchas'] = { nome: 'Limpeza de colchas', id: 'cat_limpeza_estofados' };
const primaryPath = slug => ['limpeza-de-sofa', 'lavagem-de-tapetes', 'limpeza-de-colchas'].includes(slug) ? '/' + slug + '/' : '/servicos/' + slug + '/';
const legacyVariants = {
  pintor: ['preparação do orçamento de pintura', 'Antes de pedir uma visita para pintura, separe os ambientes, o estado das paredes e os materiais disponíveis. O objetivo desta página é organizar as informações para comparar a proposta.'],
  diarista: ['planejamento da diária de limpeza', 'Escolha as prioridades da próxima diária e o horário em que o imóvel estará disponível. Liste tarefas e produtos para combinar o que cabe em uma visita de limpeza.'],
  'tecnico-em-informatica': ['triagem de defeitos do computador', 'Registre as mensagens de erro e as condições em que seu computador falha. Separe modelo, sistema e histórico do defeito antes de combinar o diagnóstico, sem compartilhar senhas no pedido.']
};
const esc = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const cleanNames = html => html
  .replace(/Limpeza e higienização de sofá/g, 'Limpeza de sofá')
  .replace(/[Ll]impeza de estofados(?! e tapetes)/g, m => m[0] + 'impeza de estofados e tapetes')
  .replace(/[Ll]impeza de estofado(?!s)/g, m => m[0] + 'impeza de estofados e tapetes');
const css = '<style data-seo-intent-style>.seo-intent{max-width:960px;margin:auto;padding:24px 20px;color:#0b1d3a;font:17px/1.65 system-ui,sans-serif}.seo-intent section{background:#fff;border:1px solid #e2e6ee;border-radius:16px;padding:22px;margin:18px 0}.seo-intent h1{font-size:clamp(28px,5vw,42px);line-height:1.2}.seo-intent h2{font-size:23px;line-height:1.3}.seo-intent a{color:#1458cc}.seo-intent a.cta{display:inline-flex;background:#c4530a;color:#fff;padding:14px 22px;border-radius:12px;font-weight:700;text-decoration:none;min-height:48px;align-items:center}.seo-intent a:focus-visible,.seo-intent summary:focus-visible{outline:3px solid #f97316;outline-offset:4px}.seo-intent details{padding:12px 0}.seo-intent summary{font-weight:700;cursor:pointer}.seo-intent .note{font-size:14px}</style>';
const sitemapFile = path.join(root, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapFile, 'utf8');
let localCount = 0, scopedCount = 0;

function addLoc(url) {
  if (!sitemap.includes('<loc>' + url + '</loc>')) sitemap = sitemap.replace('</urlset>', '<url><loc>' + url + '</loc></url>\n</urlset>');
}
function removeLoc(url) {
  sitemap = sitemap.replace(/\s*<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<\/url>/g, (entry, loc) => loc === url ? '' : entry);
}
function setMeta(html, title, desc, canonical) {
  return html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(title) + '</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + esc(desc) + '">')
    .replace(/<link rel="canonical" href="[^"]*">/, '<link rel="canonical" href="' + canonical + '">')
    .replace(/<meta property="og:title" content="[^"]*">/g, '<meta property="og:title" content="' + esc(title) + '">')
    .replace(/<meta property="og:description" content="[^"]*">/g, '<meta property="og:description" content="' + esc(desc) + '">')
    .replace(/<meta property="og:url" content="[^"]*">/g, '<meta property="og:url" content="' + canonical + '">');
}
function render(file, parts) {
  const inServices = parts[0] === 'servicos';
  const slug = parts[inServices ? 1 : 0];
  const citySlug = parts[inServices ? 2 : 1];
  const city = cities[citySlug];
  if (!slug || !(catalog[slug] || aliases[slug])) return;
  let html = cleanNames(fs.readFileSync(file, 'utf8'));
  // Guias regionais têm intenção comparativa própria e conteúdo editorial preservado.
  if (citySlug === 'abc') { fs.writeFileSync(file, html); return; }
  let alias = aliases[slug];
  if (city && !inServices && legacyVariants[slug]) alias = [slug, ...legacyVariants[slug]];
  if (city && inServices && slug === 'limpeza-de-sofa') alias = [slug, 'avaliação do tecido e das manchas', 'Antes da limpeza de sofá, identifique o tecido, fotografe a etiqueta e relate o que causou as manchas. A avaliação do material orienta a escolha do método e dos cuidados de secagem.'];
  const base = alias ? alias[0] : slug;
  const intent = intents[base];
  const service = catalog[base];
  if (!city && !intent) {
    fs.writeFileSync(file, html);
    return;
  }
  const name = intent?.name || service.nome;
  const focus = alias ? alias[1] : (intent?.focus || 'como organizar a visita e comparar propostas');
  const route = '/' + parts.join('/') + '/';
  const url = domain + route;
  // Variantes gerais legadas consolidam na página de intenção principal.
  // As páginas de cidade, inclusive variantes, têm canonical próprio.
  const canonical = city || inServices ? url : domain + primaryPath(base);
  const title = name + (city ? ' em ' + city.name : '') + ': ' + focus + ' | Quem Faz';
  const h1 = name + (city ? ' em ' + city.name : '') + (alias ? ': ' + focus : '');
  const description = (name + (city ? ' em ' + city.name : '') + ': ' + focus + '. ' + (city ? 'Informe seu bairro e planeje a visita.' : 'Publique grátis e compare contatos.'));
  // Reutiliza o CTA original com categoria, rota e parâmetros já revisados.
  const cta = html.match(/<a\b[^>]*(?:data-request|data-qf-seo-cta)[^>]*>[\s\S]*?<\/a>/)?.[0];
  if (!cta) throw Error('Página de serviço sem CTA preservável: ' + route);
  const target = intent?.primary || base;
  const targetName = intents[target]?.name || catalog[target]?.nome || name;
  const parentRoute = primaryPath(target);
  const parentCity = city ? parentRoute + citySlug + '/' : parentRoute;
  const links = '<section data-seo-group-links><h2>Orientações relacionadas</h2>' +
    (parentCity !== route ? '<p><a href="' + parentCity + '">' + esc(targetName) + (city ? ' em ' + esc(city.name) : ': guia principal') + '</a></p>' : '') +
    (parentRoute !== route && parentCity !== parentRoute ? '<p><a href="' + parentRoute + '">Guia geral de ' + esc(targetName.toLowerCase()) + '</a></p>' : '') +
    (city && base !== target ? '<p><a href="' + primaryPath(base) + '">' + esc(name) + ': escopo do serviço</a></p>' : '') + '</section>';
  const tasks = intent?.tasks || ['Descreva o que precisa, os modelos ou materiais envolvidos e as condições do local.', 'Informe o dia desejado e quais etapas devem constar na proposta.', 'Compare diagnóstico, materiais e mão de obra com o mesmo escopo.'];
  const faqs = city ? [
    [city.question, city.answer],
    ['Como preparar a visita de ' + name.toLowerCase() + ' em ' + city.areas[0] + '?', city.detail + ' ' + tasks[0]],
    [intent?.question || 'O que comparar antes de contratar ' + name.toLowerCase() + '?', intent?.answer || 'Peça uma descrição das tarefas, custos e condições de atendimento antes de contratar.']
  ] : [[intent.question, intent.answer]];
  const local = city ? '<section data-seo-local-content><h2>Planeje o atendimento em ' + esc(city.name) + '</h2><p>' + esc(city.lead) + '</p><p>' + esc(city.detail) + '</p><p>Referências de localização: ' + city.areas.map(esc).join(', ') + '. São exemplos para preencher o pedido, sem garantia de cobertura ou agenda.</p></section>' : '';
  const lead = alias ? alias[2] : (intent?.lead || 'Organize os detalhes de ' + name.toLowerCase() + ' antes de solicitar uma proposta.');
  const cityLinks = city ? '' : '<section><h2>Orientações por cidade</h2><ul>' + Object.entries(cities).map(([key, place]) => '<li><a href="' + primaryPath(base) + key + '/">' + esc(name + ' em ' + place.name) + '</a></li>').join('') + '</ul></section>';
  const content = '<main class="seo-intent" data-seo-intent="' + esc(base) + '"><nav aria-label="Localização"><a href="/servicos/">Serviços</a> / ' + esc(name) + '</nav>' +
    '<h1>' + esc(h1) + '</h1><p data-seo-service-scope>' + esc(lead) + '</p>' + cta + local +
    '<section><h2>' + esc(focus[0].toUpperCase() + focus.slice(1)) + '</h2><ul>' + tasks.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' +
    '<p>Publicar é grátis. Os contatos dependem de profissionais interessados e disponíveis para o local e o serviço informados. Você compara as propostas e decide se deseja contratar.</p></section>' +
    '<section><h2>' + (city ? 'Dúvidas para contratar em ' + esc(city.name) : 'Dúvidas sobre o serviço') + '</h2>' + faqs.map(([q, a]) => '<details><summary>' + esc(q) + '</summary><p>' + esc(a) + '</p></details>').join('') + '</section>' + links + cityLinks +
    '<section><h2>Descreva sua necessidade</h2><p>' + (city ? 'Confirme ' + esc(city.name) + ' e seu bairro antes de publicar.' : 'Informe a cidade e o bairro do atendimento.') + '</p>' + cta + '</section></main>';
  html = setMeta(html, title, description, canonical);
  html = html.replace(/<main\b[^>]*>[\s\S]*?<\/main>/, content);
  html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
  const schema = [
    { '@context': 'https://schema.org', '@type': 'Service', name: h1, serviceType: name, description, url: canonical, provider: { '@type': 'Organization', name: 'Quem Faz', url: domain + '/' }, ...(city ? { areaServed: { '@type': 'City', name: city.name } } : {}) },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faqs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  ];
  html = html.replace('</head>', css + '<script type="application/ld+json">' + json(schema) + '</script></head>');
  fs.writeFileSync(file, html);
  if (city) { addLoc(url); localCount++; }
  else { if (canonical === url) addLoc(url); else removeLoc(url); scopedCount++; }
}
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name === 'index.html') render(file, path.relative(root, dir).split(path.sep));
  }
}
walk(path.join(root, 'servicos'));
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isDirectory() && (catalog[entry.name] || aliases[entry.name])) walk(path.join(root, entry.name));
}
// Padroniza também os rótulos do índice público de serviços.
const indexFile = path.join(root, 'servicos', 'index.html');
if (fs.existsSync(indexFile)) fs.writeFileSync(indexFile, cleanNames(fs.readFileSync(indexFile, 'utf8')));
fs.writeFileSync(sitemapFile, sitemap);
if (localCount < 700 || scopedCount < 20) throw Error('Cobertura editorial SEO incompleta');
console.log('SEO intenções: ' + scopedCount + ' páginas gerais revisadas; ' + localCount + ' páginas locais com conteúdo municipal e canonical próprio.');
