// Amplia termos naturais de busca apenas onde o catálogo confirma a especialidade.
// Executado após os geradores de páginas e antes da validação do sitemap.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, '..', 'dist');
const manifest = require(path.join(out, 'seo-205-manifest.json'));
const base = 'https://quemfazservico.com.br';
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages = manifest.pages.filter(p => p.index && p.service === 'Limpeza de estofados e tapetes' && p.city);
if (!pages.length) throw Error('SEO higienização: nenhuma cidade com cobertura confirmada');
const sitemap = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
let updated = 0;
for (const page of pages) {
  const file = path.join(out, page.url, 'index.html');
  const canonical = base + page.url;
  if (!sitemap.includes('<loc>' + canonical + '</loc>')) throw Error('SEO higienização: URL fora do sitemap: ' + page.url);
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('rel="canonical" href="' + canonical + '"') ||
      !html.includes('<meta name="robots" content="index,follow">') ||
      !html.includes('id="seo-order"') || !html.includes('href="#pedido"') ||
      !html.includes('<article class="seo-content">')) {
    throw Error('SEO higienização: página sem canonical, indexação ou formulário: ' + page.url);
  }
  if (html.includes('data-qf-higienizacao-local')) throw Error('SEO higienização: seção duplicada: ' + page.url);
  const city = esc(page.city);
  const title = 'Higienização de sofá e estofados em ' + city + ' | Quem Faz';
  const description = 'Procura higienização de sofá, limpeza de estofados ou tapetes em ' + city + '? Descreva seu serviço e publique o pedido grátis no Quem Faz.';
  html = html.replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>');
  html = html.replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + description + '">');
  html = html.replace(/<meta property="og:title" content="[^"]*">/, '<meta property="og:title" content="' + title + '">');
  html = html.replace(/<meta property="og:description" content="[^"]*">/, '<meta property="og:description" content="' + description + '">');
  const section = '<section class="seo-practical" data-qf-higienizacao-local>' +
    '<h2>Higienização de sofá e limpeza de estofados em ' + city + '</h2>' +
    '<p>Para solicitar higienização de sofá, limpeza de poltronas, cadeiras estofadas ou tapetes, descreva qual peça precisa de atendimento, as dimensões e o tipo de tecido. Informe o bairro em ' + city + ' e, se possível, envie fotos das manchas.</p>' +
    '<h3>O que informar no orçamento de higienização?</h3>' +
    '<p>Explique se precisa de limpeza geral, tratamento de manchas ou remoção de odores. Pergunte qual técnica é adequada ao material, o tempo estimado de secagem e o que está incluído no preço. A remoção completa de manchas não é garantida.</p>' +
    '<p>O atendimento depende do CEP, do raio e da agenda dos profissionais cadastrados. <a href="#pedido">Publique seu pedido grátis</a> para consultar a disponibilidade.</p></section>';
  html = html.replace('</article>', section + '</article>');
  fs.writeFileSync(file, html);
  updated++;
}
console.log('SEO higienização: ' + updated + ' páginas locais com cobertura confirmada reforçadas.');
