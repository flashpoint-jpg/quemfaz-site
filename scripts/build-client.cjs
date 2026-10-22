// Mantém index.html como fonte revisável. Publica scripts menores, em paralelo, sem bloquear o HTML.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash}=require('node:crypto');
const esbuild = require('esbuild');
const root = path.join(__dirname, '..'), out = path.join(root, 'dist');
// Impede publicar um atendimento cujo arquivo JavaScript tenha erro de sintaxe.
new vm.Script(fs.readFileSync(path.join(root, 'qf-atendimento.js'), 'utf8'), {filename:'qf-atendimento.js'});
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const skip = new Set(['.git','node_modules','dist','tests','scripts','supabase','docs','.gitignore','package.json','package-lock.json','vercel.json']);
for (const name of fs.readdirSync(root)) {
  if (skip.has(name) || (name.startsWith('.') && name !== '.well-known')) continue;
  fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
}
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
// Mudança de URL evita reutilizar o JavaScript inválido que ficou no cache dos clientes.
html=html.replace('qf-atendimento.js?v=2','qf-atendimento.js?v=20261022-garante-intencao');
// Versão das extensões do piloto simplificado; preserva os arquivos-fonte já revisados.
html=html.replace(/qf-comissao13\.js\?v=[^"']+/g,'qf-comissao13.js?v=simplificado20261023').replace(/qf-atendimento\.js\?v=[^"']+/g,'qf-atendimento.js?v=simplificado20261023');
const adminPath=path.join(out,'admin.html');
fs.writeFileSync(adminPath,fs.readFileSync(adminPath,'utf8').replace(/qf-comissao13\.js\?v=[^"']+/g,'qf-comissao13.js?v=simplificado20261023'));
// Favicon tradicional para Google e navegadores, sem alterar a interface.
require('./generate-favicon.cjs');
// Declara apenas ICO e PNG derivados da mesma arte oficial, evitando ícones conflitantes.
const headEnd=html.indexOf('</head>');
if (headEnd<0) throw Error('Fechamento head ausente');
const head=html.slice(0,headEnd);
const tail=html.slice(headEnd);
const cleanHead=head.replace(/<link\b[^>]*\brel\s*=\s*(?:"icon"|'icon')[^>]*>/gi,'');
html=cleanHead+'<link rel="icon" type="image/x-icon" href="/favicon.ico">\n<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png">\n'+tail;
for (const file of ['favicon.ico','favicon.png']) {
  if (!fs.existsSync(path.join(out,file))) throw Error('Favicon ausente no dist: '+file);
}
const version=/const APP_VERSION = '([^']+)'/.exec(html)[1];
const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const main=inline.find(m=>m[1].includes('biblioteca de ícones'));
const shell=inline.find(m=>m[1].includes('const QF_BRAND_MARK ='));
if (!main || !shell) throw Error('Blocos do aplicativo não encontrados');
const assets=[];
for (const [kind,script] of [['main',main],['shell',shell]]) {
  let source=script[1];
  if (kind==='shell') {
    const ext=fs.readFileSync(path.join(__dirname,'qf-other-jobs-extension.js'),'utf8');
    const routeAnchor='  const routes = [';
    const existingRoute="    { pattern: '/profissional/servicos/disponiveis', role: 'profissional', tab: 'servicos', title: 'Serviços disponíveis', render: Screens.profServicosDisponiveisRender },";
    if (!source.includes(routeAnchor) || !source.includes(existingRoute)) throw Error('Rota de servicos do profissional nao encontrada');
    source=source.replace(routeAnchor,ext+'\n'+routeAnchor);
    source=source.replace(existingRoute,existingRoute+"\n    { pattern: '/profissional/outros-pedidos', role: 'profissional', tab: 'servicos', title: 'Outros pedidos', render: Screens.profOutrosPedidosRender },");
  }
  const code=esbuild.transformSync(source,{loader:'js',minify:true,keepNames:true,charset:'utf8',target:'es2020',legalComments:'inline'}).code;
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
html=html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g,(_,attrs,css)=>{
  const code=esbuild.transformSync(css,{loader:'css',minify:true}).code;
  // A folha principal era repetida em cada navegação no HTML sem cache.
  // Mantém a mesma posição na cascata e os estilos identificados no documento.
  if (!attrs.trim() && Buffer.byteLength(code)>65536) {
    const hash=createHash('sha256').update(code).digest('hex').slice(0,12);
    const filename='app-style-'+version+'-'+hash+'.css';
    fs.writeFileSync(path.join(out,filename),code);
    assets.push('./'+filename);
    return '<link rel="stylesheet" href="'+filename+'">';
  }
  return '<style'+attrs+'>'+code+'</style>';
});
// Aplicativo oficial publicado na Google Play: manter os selos da home visiveis.
// Corrigir o destino somente dos selos da Play Store, sem mudar os demais links do site.
const qfPlayStoreUrl = 'https://play.google.com/store/apps/details?id=br.app.quemfaz';
const qfPlayStoreLinkFix = `<script>
(function(){
  var playStoreUrl = ${JSON.stringify(qfPlayStoreUrl)};
  function atualizarSelosPlayStore(){
    document.querySelectorAll('a.qf-play-badge').forEach(function(a){
      a.href = playStoreUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.removeAttribute('aria-disabled');
      a.setAttribute('aria-label', 'Baixar QuemFaz na Google Play');
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', atualizarSelosPlayStore);
  else atualizarSelosPlayStore();
  document.addEventListener('click', function(event){
    var badge = event.target.closest && event.target.closest('a.qf-play-badge');
    if(badge) badge.href = playStoreUrl;
  }, true);
})();
</script>`;
html=html.replace('</body>',qfPlayStoreLinkFix+'</body>');


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
  document.addEventListener('submit',function(e){if(ready)return;if(!e.target.matches('[data-landing-service-form]'))return;e.preventDefault();early.capture();pending=null;w.QFHomeDraft={service:(saved||'').trim()};try{sessionStorage.removeItem('qf_pending_category');}catch(_){}location.hash='#/auth/cliente/cadastro';var shell=document.getElementById('app-shell');if(shell)shell.outerHTML=loading;w.setTimeout(function(){if(ready||location.hash!=='#/auth/cliente/cadastro')return;var content=document.getElementById('app-content');if(content)content.innerHTML='<div class="card stack" style="max-width:560px;margin:32px auto;padding:24px"><h2>Não foi possível abrir o pedido</h2><p>Verifique sua conexão e toque em tentar novamente.</p><button class="btn btn--primary" onclick="location.reload()">Tentar novamente</button></div>';},12000);},true);
  document.addEventListener('click',function(e){if(ready)return;var b=e.target.closest('[data-nav],[data-action="landing-login"],[data-support-open]');if(!b)return;e.preventDefault();early.capture();var nav=b.getAttribute('data-nav');if(nav){location.hash='#'+nav;document.getElementById('app-shell').outerHTML=loading;}else pending=b.hasAttribute('data-support-open')?'[data-support-open]':'[data-action="landing-login"]';},true);
})(window);`;
new vm.Script(early);
html=html.slice(0,opening)+landing+'<script>'+early+'</script>\n'+html.slice(closing);
// Valida CEP digitado no campo de cidade antes do envio do cliente.
html=html.replace('</body>','<script src="/qf-city-cep-resolver.js"></script></body>');
// Mostra claramente saldo sem vencimento e créditos de plano com validade.
html=html.replace('</body>','<script defer src="/qf-wallet-balance-rules.js?v=20261014"></script></body>');
// Relogio da validade do bonus, consultando o valor promocional no Supabase.
html=html.replace('</body>','<script defer src="/qf-bonus-clock.js?v=20261014"></script></body>');
// Monitoramento de como o profissional acessa (app Android, PWA ou navegador). So grava com sessao de profissional.
html=html.replace('</body>','<script defer src="/qf-acesso-profissional.js?v=20261018"></script></body>');
fs.copyFileSync(path.join(__dirname,'qf-seo-consent-widget.js'),path.join(out,'qf-seo-consent-widget.js'));
// Consentimento opcional: telas de cadastro e perfil profissional, sem bloquear fluxos existentes.
html=html.replace('</body>','<script defer src="/qf-seo-consent-widget.js"></script></body>');
fs.writeFileSync(path.join(out,'index.html'),html);
let sw=fs.readFileSync(path.join(out,'sw.js'),'utf8');
sw=sw.replace('./qf-atendimento.js?v=2','./qf-atendimento.js?v=20261022-garante-intencao');
sw=sw.replace("const CACHE = 'quemfaz-' + SW_VERSION;","const CACHE = 'quemfaz-' + SW_VERSION + '-simplificado13-v1';");
sw=sw.replace('const CORE = [','const CORE = ['+assets.map(x=>JSON.stringify(x)).join(',')+',');
fs.writeFileSync(path.join(out,'sw.js'),sw);
console.log('Publicação '+version+': HTML '+Buffer.byteLength(html)+' bytes; scripts deferidos e home pronta antes do SDK.');

// Gera páginas SEO sem alterar a home principal.
require('./generate-seo-pages.cjs');

require('./generate-seo-extra.cjs');

// Falha o build se o sitemap gerado tiver URLs malformadas ou duplicadas.
require('./generate-seo-sp.cjs');
require('./improve-local-pages.cjs');
require('./repair-seo-leads.cjs');
require('./seo-hub-icons.cjs');
// V11.96: guias do ABC, consolidação de páginas finas e passagem de UTM/gclid/msclkid.
require('./seo-abc.cjs');
require('./check-sitemap.cjs');
