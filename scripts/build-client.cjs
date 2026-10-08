// Mantém index.html como fonte revisável. Publica scripts menores, em paralelo, sem bloquear o HTML.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash}=require('node:crypto');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const skip = new Set(['.git','node_modules','dist','tests','scripts','supabase','.gitignore','package.json','package-lock.json','vercel.json']);
for (const name of fs.readdirSync(root)) {
  if (skip.has(name) || (name.startsWith('.') && name !== '.well-known')) continue;
  fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
}
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const version=/const APP_VERSION = '([^']+)'/.exec(html)[1];
const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const main=inline.find(m=>m[1].includes('biblioteca de ícones'));
const shell=inline.find(m=>m[1].includes('const QF_BRAND_MARK ='));
if (!main || !shell) throw Error('Blocos do aplicativo não encontrados');
const assets=[];
for (const [kind,script] of [['main',main],['shell',shell]]) {
  const code=esbuild.transformSync(script[1],{loader:'js',minify:true,keepNames:true,charset:'utf8',target:'es2020',legalComments:'inline'}).code;
  const hash=createHash('sha256').update(code).digest('hex').slice(0,12);
  const filename='app-'+kind+'-'+version+'-'+hash+'.js';
  new vm.Script(code,{filename});
  fs.writeFileSync(path.join(out,filename),code);
  html=html.replace(script[0],'<script defer src="'+filename+'"></script>');
  assets.push('./'+filename);
}
// Downloads do SDK e dos scripts do app acontecem juntos; a ordem de execução continua preservada.
html=html.replace(/<script src="([^"]+)"/g,'<script defer src="$1"');
html=html.replace(/<link rel="preload" as="image" href="([^"]+)" fetchpriority="high">/,(_,url)=>'<script>if(!location.hash||location.hash==="#/"){var qfHeroPreload=document.createElement("link");qfHeroPreload.rel="preload";qfHeroPreload.as="image";qfHeroPreload.href='+JSON.stringify(url)+';qfHeroPreload.fetchPriority="high";document.head.appendChild(qfHeroPreload);}</script>');
html=html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g,(_,attrs,css)=>'<style'+attrs+'>'+esbuild.transformSync(css,{loader:'css',minify:true}).code+'</style>');

// A home já mostra o conteúdo aprovado enquanto os scripts chegam. Não é uma tela de espera.
const iconStart=main[1].indexOf('(function (global) {');
const iconEnd=main[1].indexOf('})(window);',iconStart)+'})(window);'.length;
const scope={window:{},Screens:{},DB:{categories:()=>[]}};
vm.createContext(scope);vm.runInContext(main[1].slice(iconStart,iconEnd),scope);
scope.icon=scope.window.icon;scope.global=scope.window;
scope.window.QFApp={VERSION:version,topInstallHtml:()=>'<span class="qf-top-slot" data-top-install></span>'};
const brand=/const QF_BRAND_MARK = global.QF_BRAND_MARK = ([^\n]+);/.exec(shell[1]);
if (brand) scope.window.QF_BRAND_MARK=vm.runInNewContext(brand[1]);
const landingStart=main[1].indexOf('  Screens.landing = function () {');
const landingEnd=main[1].indexOf('  function roleCard(',landingStart);
vm.runInContext(main[1].slice(landingStart,landingEnd),scope);
const opening=html.indexOf('<div id="app-shell">'),closing=html.indexOf('<script defer src="app-main-',opening);
const placeholder=html.slice(opening,closing);
const landing='<div id="app-shell" data-route="inicio" data-role="anon" data-qf-prerender="home"><main id="app-content">'+scope.Screens.landing()+'</main></div>';
const early=`(function(w){
  var saved='',fields={},pending=null,loading=${JSON.stringify(placeholder)},ready=false;
  var early=w.QFEarly={capture:function(){if(ready)return;var x=document.querySelector('[data-landing-service-search]');if(x)saved=x.value;['data-landing-location','data-landing-neighborhood'].forEach(function(k){var el=document.querySelector('['+k+']');if(el)fields[k]=el.value;});},restore:function(content){if(ready)return;var x=content.querySelector('[data-landing-service-search]');Object.keys(fields).forEach(function(k){var el=content.querySelector('['+k+']');if(el)el.value=fields[k];});if(x&&saved){x.value=saved;x.dispatchEvent(new Event('input',{bubbles:true}));}},finish:function(){ready=true;if(pending){var e=document.querySelector(pending);pending=null;if(e){if(e.tagName==='FORM')e.requestSubmit();else e.click();}}}};
  if(location.hash&&location.hash!=='#/')document.getElementById('app-shell').outerHTML=loading;
  document.addEventListener('submit',function(e){if(ready)return;early.capture();if(e.target.matches('[data-landing-service-form]')){e.preventDefault();pending='[data-landing-service-form]';var b=e.target.querySelector('[type="submit"]');if(b)b.textContent='Abrindo pedido…';}},true);
  document.addEventListener('click',function(e){if(ready)return;var b=e.target.closest('[data-nav],[data-action="landing-login"],[data-support-open]');if(!b)return;e.preventDefault();early.capture();var nav=b.getAttribute('data-nav');if(nav){location.hash='#'+nav;document.getElementById('app-shell').outerHTML=loading;}else pending=b.hasAttribute('data-support-open')?'[data-support-open]':'[data-action="landing-login"]';},true);
})(window);`;
new vm.Script(early);
html=html.slice(0,opening)+landing+'<script>'+early+'</script>\n'+html.slice(closing);
fs.writeFileSync(path.join(out,'index.html'),html);
let sw=fs.readFileSync(path.join(out,'sw.js'),'utf8');
sw=sw.replace('const CORE = [','const CORE = ['+assets.map(x=>JSON.stringify(x)).join(',')+',');
fs.writeFileSync(path.join(out,'sw.js'),sw);
console.log('Publicação '+version+': HTML '+Buffer.byteLength(html)+' bytes; scripts deferidos e home pronta antes do SDK.');

// Gera páginas SEO sem alterar a home principal.
require('./generate-seo-pages.cjs');

require('./generate-seo-extra.cjs');

// Falha o build se o sitemap gerado tiver URLs malformadas ou duplicadas.
require('./check-sitemap.cjs');
