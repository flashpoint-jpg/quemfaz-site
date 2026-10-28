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
const skip = new Set(['.git','node_modules','dist','tests','scripts','supabase','docs','android-notification-fix','.gitignore','package.json','package-lock.json','vercel.json']);
for (const name of fs.readdirSync(root)) {
  if (skip.has(name) || (name.startsWith('.') && name !== '.well-known')) continue;
  fs.cpSync(path.join(root,name),path.join(out,name),{recursive:true});
}
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace(/const APP_VERSION = '[^']+'/,"const APP_VERSION = '12.1.46'");
html=html.replace(/qf-livre\.js\?v=[^"']+/g,'qf-livre.js?v=cadastro-pago-20261028');
html=html.replace(/qf-client-acquisition\.js\?v=[^"']+/g,'qf-client-acquisition.js?v=eletrodomesticos-20261027').replace(/qf-conversao\.js\?v=[^"']+/g,'qf-conversao.js?v=eletrodomesticos-20261027');
// Não expõe links privados de verificação/recuperação a plataformas de medição.
const authTokenCheck = String.raw`/^#\/auth\/cliente\/(verificar|redefinir)\//.test(location.hash)`;
html=html.replace("!function(f,b,e,v,n,t,s){if(f.fbq)return;", "if (!("+authTokenCheck+")) { !function(f,b,e,v,n,t,s){if(f.fbq)return;")
 .replace("fbq('track','PageView');", "fbq('track','PageView'); }");
const googleTag='<script async src="https://www.googletagmanager.com/gtag/js?id=AW-18273159663"></script>';
html=html.replace(googleTag,'<script>if (!('+authTokenCheck+')) { var tag=document.createElement("script");tag.async=true;tag.src="https://www.googletagmanager.com/gtag/js?id=AW-18273159663";document.head.appendChild(tag); }</script>');
html=html.replaceAll('e chamar você no WhatsApp.','e conversar com você aqui.');
html=html.replaceAll('Sem cadastro obrigatório · Pedido gratuito','Pedido gratuito · Acesso por telefone e senha').replaceAll('Grátis e sem cadastro.','Grátis. Acompanhe tudo aqui mesmo.');
html=html.replace('    const found = matchRoute(path);',"    if (global.QFPedidoHome?.isInlinePath(path)) { global.QFPedidoHome.openPath(path); return; }\n    const found = matchRoute(path);");
// Clientes permanecem na home inclusive com sessão ativa; preserva a entrada profissional.
html=html.replace("if (found && found.route.publicPage) { renderAnon(found); return; }", "if (found && (found.route.publicPage || (path === '/' && currentSession()?.role === 'cliente'))) { renderAnon(found); return; }");
html=html.replace('function userIsEditing() {','function userIsEditing() { if (global.QFPedidoHome?.isBusy()) return true;');
// O login por senha substitui o redirecionamento do login antigo para a home.
html=html.replace("if (path === '/auth/cliente/login') { navigate('/', true); return; }",'');
// Rotas dos links enviados pelo serviço de contas já implantado, abertas também com sessão ativa.
html=html.replace("const routes = [",`const routes = [
 {pattern:'/auth/cliente/verificar/:token',anon:true,publicPage:true,render:p=>'<div class="view card stack" data-client-token data-kind="verificar" data-token="'+PU.escapeHtml(p.token)+'"></div>'},
 {pattern:'/auth/cliente/redefinir/:token',anon:true,publicPage:true,render:p=>'<div class="view card stack" data-client-token data-kind="redefinir" data-token="'+PU.escapeHtml(p.token)+'"></div>'},`);
html=html.replace('</body>','<script defer src="/qf-cliente-acesso.js?v=simples-20261027"></script><script defer src="/qf-pedido-home.js?v=eletrodomesticos-20261027"></script></body>');
// Mudança de URL evita reutilizar o JavaScript inválido que ficou no cache dos clientes.
// Versão das extensões do piloto simplificado; preserva os arquivos-fonte já revisados.
html=html.replace(/qf-comissao13\.js\?v=[^"']+/g,'qf-comissao13.js?v=card-unico-20261027').replace(/qf-atendimento\.js\?v=[^"']+/g,'qf-atendimento.js?v=eletrodomesticos-20261027');
const adminPath=path.join(out,'admin.html');
fs.writeFileSync(adminPath,fs.readFileSync(adminPath,'utf8').replace(/qf-comissao13\.js\?v=[^"']+/g,'qf-comissao13.js?v=card-unico-20261027'));
// Rotas e abas administrativas instaladas antes da inicialização do roteador.
let adminHtml=fs.readFileSync(adminPath,'utf8');
adminHtml=adminHtml.replace(/<script src="qf-comissao13\.js[^"']*"><\/script>/g,'');
adminHtml=adminHtml.replace('<script>\n/* QuemFaz — casca do app, roteador por hash e navegação. */','<script src="qf-comissao13.js?v=card-unico-20261027"></script><script src="qf-admin-espelho.js?v=profissionais20261023"></script>\n<script>\n/* QuemFaz — casca do app, roteador por hash e navegação. */');
const routeMarker="    { pattern: '/admin/dashboard', role: 'admin', tab: 'dashboard'";
if(!adminHtml.includes(routeMarker))throw Error('Rota administrativa ausente');
adminHtml=adminHtml.replace(routeMarker,"    { pattern: '/admin/espelho-profissionais', role: 'admin', title: 'Espelho dos profissionais', render: Screens.adminEspelhoRender },\n    { pattern: '/admin/espelho-profissionais/:id', role: 'admin', title: 'Tela do profissional', back: '/admin/espelho-profissionais', render: Screens.adminEspelhoDetalheRender },\n"+routeMarker);
const menuMarker="    { section: 'Pedidos' },";
adminHtml=adminHtml.replace(menuMarker,menuMarker+"\n    { id: 'espelho', label: 'Espelho dos profissionais', icon: 'smartphone', route: '/admin/espelho-profissionais', also: ['/admin/espelho-profissionais/:id'] },\n    { id: 'comissao13', label: 'Comissões de 13%', icon: 'unlock', route: '/admin/comissao13' },");
adminHtml=adminHtml.replace('2026-10-12-cache-fix','2026-10-23-admin-claro').replace('qf_admin_reload_20261012','qf_admin_reload_20261023_claro');
adminHtml=adminHtml.replace(/qf-admin-valor\.js\?v=[^"']+/g,'qf-admin-valor.js?v=divisao87-20261026');
fs.writeFileSync(adminPath,adminHtml);
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
  if(kind==='main')source=source.replace('function requestFromCloud(row, professionalId) {','global.QFRequestFromCloud=requestFromCloud; global.QFQuoteFromCloud=quoteFromCloud; function requestFromCloud(row, professionalId) {');
  if(kind==='main')source=source.replace('function renderConversationCards(rows, req) {','global.QFConversationCards=renderConversationCards; function renderConversationCards(rows, req) {');
  if (kind==='shell') {
    const ext=fs.readFileSync(path.join(__dirname,'qf-other-jobs-extension.js'),'utf8');
    const routeAnchor='  const routes = [';
    const existingRoute="    { pattern: '/profissional/servicos/disponiveis', role: 'profissional', tab: 'servicos', title: 'Serviços disponíveis', render: Screens.profServicosDisponiveisRender },";
    if (!source.includes(routeAnchor) || !source.includes(existingRoute)) throw Error('Rota de servicos do profissional nao encontrada');
    source=source.replace(routeAnchor,ext+'\n'+routeAnchor);
    source=source.replace(existingRoute,existingRoute+"\n    { pattern: '/profissional/outros-pedidos', role: 'profissional', tab: 'servicos', title: 'Pedidos para você', render: Screens.profOutrosPedidosRender },");
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
  var early=w.QFEarly={capture:function(){if(ready)return;var x=document.querySelector('[data-landing-service-search]');if(x)saved=x.value;['data-landing-location','data-landing-neighborhood'].forEach(function(k){var el=document.querySelector('['+k+']');if(el)fields[k]=el.value;});},restore:function(content){if(ready)return;var x=content.querySelector('[data-landing-service-search],#home-problem');Object.keys(fields).forEach(function(k){var el=content.querySelector('['+k+']');if(el)el.value=fields[k];});if(x&&saved){x.value=saved;x.dispatchEvent(new Event('input',{bubbles:true}));}},finish:function(){ready=true;if(pending){var e=document.querySelector(pending);pending=null;if(e){if(e.tagName==='FORM')e.requestSubmit();else e.click();}}}};
  if(location.hash&&location.hash!=='#/')document.getElementById('app-shell').outerHTML=loading;
  document.addEventListener('submit',function(e){if(ready)return;if(!e.target.matches('[data-landing-service-form]'))return;e.preventDefault();early.capture();w.QFHomeDraft={service:(saved||'').trim()};pending='[data-home-problem]';},true);
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
// Mesmo HTML/CSS e renderizador do site público; a prévia só aceita dados do painel na mesma origem.
fs.writeFileSync(path.join(out,'espelho-cliente.html'),html.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>').replace('</body>','<script src="/qf-admin-mirror-frame.js?v=20261023"></script></body>'));

fs.writeFileSync(path.join(out,'espelho-profissional.html'),html.replace('</head>','<meta name="robots" content="noindex,nofollow"></head>').replace('</body>','<script src="/qf-admin-prof-mirror-frame.js?v=20261023"></script></body>'));
let sw=fs.readFileSync(path.join(out,'sw.js'),'utf8');
sw=sw.replace("const CACHE = 'quemfaz-' + SW_VERSION;","const CACHE = 'quemfaz-' + SW_VERSION + '-card-unico-20261027';");
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
require('./seo-index-links.cjs');
require('./check-sitemap.cjs');
