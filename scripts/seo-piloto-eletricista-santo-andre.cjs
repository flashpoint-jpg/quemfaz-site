// Remove blocos de orientação repetidos sem tocar no formulário ou layout.
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'dist', 'servicos', 'eletricista', 'santo-andre', 'index.html');
let html = fs.readFileSync(file, 'utf8');
const original = html;
const repeatedHeadings = [
  'Quando solicitar eletricista?',
  'Como explicar uma falha elétrica?'
];

for (const heading of repeatedHeadings) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp('<section class="seo-practical"[^>]*>\\s*<h2>' + escaped + '<\\/h2>[\\s\\S]*?<\\/section>', 'g');
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw Error('Piloto SEO: bloco repetido inesperado: ' + heading + ' (' + matches.length + ')');
  html = html.replace(pattern, '');
}

if (!html.includes('id="seo-order"') || !html.includes('href="#pedido"') ||
    !html.includes('rel="canonical" href="https://quemfazservico.com.br/servicos/eletricista/santo-andre/"') ||
    !html.includes('Instalações e trocas: defina cada ponto do serviço')) {
  throw Error('Piloto SEO: formulário, canonical ou orientação principal ausente');
}
if (html === original) throw Error('Piloto SEO: nenhuma alteração editorial aplicada');
fs.writeFileSync(file, html);
console.log('SEO piloto: duas seções repetidas removidas de eletricista/Santo André.');
