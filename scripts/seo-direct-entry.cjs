// Endereços antigos de divulgação profissional continuam abrindo o cadastro.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dist');
function enhance(file, target) {
  if (!fs.existsSync(file)) return;
  let html = fs.readFileSync(file, 'utf8');
  if (!/<head(?:\s[^>]*)?>/i.test(html) || html.includes('data-qf-direct-organic')) return;
  // Não alterar dados de publicação, login, pagamentos nem outras páginas do app.
  const script = '<script data-qf-direct-organic>(function(){' +
    'try{var to=new URL(' + JSON.stringify(target) + ',location.origin);' +
    'var incoming=new URLSearchParams(location.search);' +
    'incoming.forEach(function(v,k){if(k!=="servico"&&k!=="seo_page")to.searchParams.append(k,v);});' +
    'location.replace(to.href);' +
    '}catch(e){location.replace(' + JSON.stringify(target) + ');}' +
    '})();</script>';
  const noscript = '<noscript><meta http-equiv="refresh" content="0;url=' +
    target.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '"></noscript>';
  html = html.replace(/<head(?:\s[^>]*)?>/i, m => m + script + noscript);
  fs.writeFileSync(file, html);
}
// Endereços de divulgação para profissionais sempre abrem o cadastro profissional.
for (const alias of ['cadastro-profissional', 'seja-profissional', 'profissionais/cadastro']) {
  const dir = path.join(root, alias);
  fs.mkdirSync(dir, { recursive:true });
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cadastro profissional | Quem Faz</title><meta name="robots" content="noindex,follow"></head><body><a href="/#/auth/profissional/cadastro">Abrir cadastro profissional</a></body></html>');
  enhance(file, '/#/auth/profissional/cadastro');
}
// O roteador da home também atende URLs sem a barra final no servidor.
const homeFile = path.join(root, 'index.html');
let homeHtml = fs.readFileSync(homeFile, 'utf8');
const proBootstrap = '<script data-qf-pro-organic>(function(){' +
  'if(["/cadastro-profissional","/cadastro-profissional/","/seja-profissional","/seja-profissional/","/profissionais/cadastro","/profissionais/cadastro/"].includes(location.pathname)){' +
  'var to=new URL("/#/auth/profissional/cadastro",location.origin);' +
  'new URLSearchParams(location.search).forEach(function(v,k){to.searchParams.append(k,v);});' +
  'location.replace(to.href);' +
  '}' +
  '})();</script>';
if (!homeHtml.includes('data-qf-pro-organic')) {
  homeHtml = homeHtml.replace(/<head(?:\s[^>]*)?>/i, m => m + proBootstrap);
  fs.writeFileSync(homeFile, homeHtml);
}
