// Entrada direta das páginas orgânicas para o fluxo real do Quem Faz.
// Mantém os arquivos gerados para compatibilidade, mas não exige segundo clique.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dist');
const source = fs.readFileSync(path.join(__dirname, 'generate-seo-pages.cjs'), 'utf8');
const match = source.match(/const services=(\[[^\n]+\]);\s*const cities=/);
if (!match) throw Error('SEO direto: categorias não encontradas');
const services = JSON.parse(match[1]);
const extra = [
  ['limpeza-de-sofa', 'cat_limpeza_estofados'],
  ['higienizacao-de-sofa', 'cat_limpeza_estofados'],
  ['lavagem-de-tapetes', 'cat_limpeza_estofados'],
  ['limpeza-de-colchas', 'cat_limpeza_estofados'],
  ['limpeza-de-estofado', 'cat_limpeza_estofados'],
  ['limpeza-pos-obra', 'cat_faxina_pos_obra'],
  ['tecnico-em-automacao', 'cat_automacao_residencial'],
  ['tecnico-em-informatica', 'cat_informatica'],
  ['diarista', 'cat_diarista'],
  ['faxineira', 'cat_diarista'],
  ['pintor', 'cat_pintor']
];
let modified = 0;
function enhance(file, target) {
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, 'utf8');
  if (!/<head(?:\s[^>]*)?>/i.test(html) || html.includes('data-qf-direct-organic')) return;
  // Não alterar dados de publicação, login, pagamentos nem outras páginas do app.
  const script = '<script data-qf-direct-organic>(function(){' +
    'try{var to=new URL(' + JSON.stringify(target) + ',location.origin);' +
    'var incoming=new URLSearchParams(location.search);' +
    'incoming.forEach(function(v,k){if(k!=="servico"&&k!=="seo_page")to.searchParams.append(k,v);});' +
    'if(location.pathname.indexOf("/servicos/")===0)to.searchParams.set("seo_page",location.pathname);' +
    'location.replace(to.href);' +
    '}catch(e){location.replace(' + JSON.stringify(target) + ');}' +
    '})();</script>';
  const noscript = '<noscript><meta http-equiv="refresh" content="0;url=' +
    target.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '"></noscript>';
  html = html.replace(/<head(?:\s[^>]*)?>/i, m => m + script + noscript);
  fs.writeFileSync(file, html);
  modified++;
}
function visit(folder, target) {
  if (!fs.existsSync(folder)) return;
  for (const entry of fs.readdirSync(folder, { withFileTypes:true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(file, target);
    else if (entry.name === 'index.html') enhance(file, target);
  }
}
for (const service of services) {
  visit(path.join(root, 'servicos', service.slug), '/?servico=' + encodeURIComponent(service.id));
}
for (const [slug, cat] of extra) visit(path.join(root, slug), '/?servico=' + encodeURIComponent(cat));
enhance(path.join(root, 'servicos', 'index.html'), '/');
// Endereços de divulgação para profissionais sempre abrem o cadastro profissional.
for (const alias of ['cadastro-profissional', 'seja-profissional', 'profissionais/cadastro']) {
  const dir = path.join(root, alias);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cadastro profissional | Quem Faz</title><meta name="robots" content="noindex,follow"></head><body><a href="/#/auth/profissional/cadastro">Abrir cadastro profissional</a></body></html>');
  enhance(file, '/#/auth/profissional/cadastro');
}
if (modified < 850) throw Error('SEO direto: páginas insuficientes (' + modified + ')');
console.log('SEO direto: ' + modified + ' páginas entrando no site sem clique intermediário.');
