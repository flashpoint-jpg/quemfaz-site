const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { intents } = require('../scripts/seo-intent-content.cjs');
const cities = require('../scripts/seo-city-content.cjs');
const root = path.join(__dirname, '..', 'dist');
const domain = 'https://quemfazservico.com.br';
const read = route => fs.readFileSync(path.join(root, route, 'index.html'), 'utf8');
const main = html => html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/)[1];
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const groups = [
  ['pedreiro', 'azulejista-pisos', 'gesseiro'],
  ['eletricista', 'automacao-residencial', 'instalador-de-cameras-cftv-e-alarmes'],
  ['jardineiro', 'poda-de-arvores-paisagista'],
  ['diarista', 'faxina-pos-obra', 'passadeira'],
  ['frete-carreto', 'mudancas'],
  ['tecnico-em-informatica', 'tecnico-de-internet-e-redes'],
  ['mecanico', 'autoeletrico', 'bateria-automotiva']
];

test('grupos possuem metadados, escopos e links de intenção distintos', () => {
  for (const group of groups) {
    const pages = group.map(slug => read('servicos/' + slug));
    for (const pattern of [/<title>(.*?)<\/title>/, /<h1>(.*?)<\/h1>/, /<meta name="description" content="([^"]+)"/, /<p data-seo-service-scope>(.*?)<\/p>/]) {
      assert.equal(new Set(pages.map(html => html.match(pattern)[1])).size, group.length, group.join(', '));
    }
    for (const slug of group.slice(1)) {
      const html = read('servicos/' + slug);
      assert.ok(html.includes('href="/servicos/' + group[0] + '/"'), slug + ' link para principal');
      const local = read('servicos/' + slug + '/santo-andre');
      assert.ok(local.includes('href="/servicos/' + group[0] + '/santo-andre/"'), slug + ' link local para principal');
    }
  }
  for (const route of ['servicos/pedreiro', ...Object.keys(cities).map(c => 'servicos/pedreiro/' + c)]) {
    assert.doesNotMatch(text(main(read(route))), /\b(pisos?|azulejos?|porcelanato|rejunte)\b/i, route);
  }
  assert.doesNotMatch(text(main(read('servicos/diarista'))), /passar roupas?|pós-obra/i);
});

test('todas as páginas municipais têm canonical próprio, sitemap e conteúdo local verificável', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  let checked = 0;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(file); continue; }
      if (entry.name !== 'index.html') continue;
      const parts = path.relative(root, dir).split(path.sep);
      const city = cities[parts.at(-1)];
      if (!city || !(/^(servicos\/|limpeza-|higienizacao-|lavagem-|tecnico-|diarista\/|faxineira\/|pintor\/)/.test(parts.join('/')))) continue;
      const route = '/' + parts.join('/') + '/';
      const html = fs.readFileSync(file, 'utf8');
      const canonicals = [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)];
      assert.equal(canonicals.length, 1, route);
      assert.equal(canonicals[0][1], domain + route, route);
      assert.ok(sitemap.includes('<loc>' + domain + route + '</loc>'), route + ' sitemap');
      assert.ok(html.includes('data-seo-local-content'), route);
      assert.ok(html.includes(city.lead.replaceAll('&', '&amp;')), route + ' texto municipal');
      for (const area of city.areas) assert.ok(html.includes(area), route + ' referência geográfica');
      assert.ok(html.includes(city.question), route + ' FAQ municipal');
      const schemas = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => JSON.parse(m[1]));
      const faq = schemas.find(s => s['@type'] === 'FAQPage');
      assert.ok(faq, route + ' FAQ schema');
      for (const item of faq.mainEntity) {
        assert.ok(html.includes(item.name.replaceAll('&', '&amp;')), route + ' pergunta visível');
        assert.ok(html.includes(item.acceptedAnswer.text.replaceAll('&', '&amp;')), route + ' resposta visível');
      }
      assert.ok(/data-request|data-qf-seo-cta/.test(html), route + ' CTA');
      assert.ok(html.includes("'msclkid','fbclid'"), route + ' atribuição preservada');
      for (const link of main(html).matchAll(/href="(\/[^"?#]*)"/g)) {
        assert.ok(fs.existsSync(path.join(root, link[1], 'index.html')), route + ' link: ' + link[1]);
      }
      checked++;
    }
  }
  walk(root);
  assert.equal(checked, 853);
});

test('conteúdo municipal não é apenas o texto geral com outro nome de cidade', () => {
  for (const slug of Object.keys(intents).filter(s => s !== 'limpeza-de-sofa')) {
    const cityTexts = Object.keys(cities).map(c => {
      const html = read('servicos/' + slug + '/' + c);
      const local = html.match(/<section data-seo-local-content>([\s\S]*?)<\/section>/)[1];
      let normalized = text(local);
      for (const city of Object.values(cities)) {
        normalized = normalized.replaceAll(city.name, '[cidade]');
        for (const area of city.areas) normalized = normalized.replaceAll(area, '[bairro]');
      }
      assert.ok(!main(read('servicos/' + slug)).includes(local), slug);
      return normalized;
    });
    assert.equal(new Set(cityTexts).size, 11, slug + ' variação municipal real');
  }
  const legacy = read('tecnico-em-informatica/santo-andre');
  const current = read('servicos/tecnico-em-informatica/santo-andre');
  assert.notEqual(text(main(legacy)), text(main(current)), 'variante legada tem escopo próprio');
});

test('links editoriais apontam para páginas existentes e limpeza usa nomes padronizados', () => {
  for (const slug of Object.keys(intents)) {
    const route = slug === 'limpeza-de-sofa' ? slug : 'servicos/' + slug;
    const html = read(route);
    for (const m of main(html).matchAll(/href="(\/[^"?#]*)"/g)) {
      if (m[1] === '/') continue;
      assert.ok(fs.existsSync(path.join(root, m[1], 'index.html')), route + ' → ' + m[1]);
    }
  }
  assert.match(read('limpeza-de-sofa'), /<h1>Limpeza de sofá<\/h1>/);
  assert.match(read('servicos/limpeza-de-estofados-e-tapetes'), /<h1>Limpeza de estofados e tapetes<\/h1>/);
  assert.doesNotMatch(read('servicos/limpeza-de-estofados-e-tapetes/abc'), /Limpeza de estofados(?! e tapetes)/);
  assert.ok(!fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').includes('<loc>' + domain + '/higienizacao-de-sofa/</loc>'));
});
