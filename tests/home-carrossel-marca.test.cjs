// V11.72: mini carrossel "Anuncie sua marca aqui" abaixo da foto da tela inicial, com botão para os planos.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
// A composição inicial não contém publicidade ou planos profissionais.
const prerender=html.slice(html.indexOf('id="app-shell"'),html.indexOf('<script defer src="app-main-'));
assert.ok(prerender.includes('data-landing-service-form'));
assert.ok(!prerender.includes('data-brandrot'));
assert.ok(!prerender.includes('data-qf-home-livre'));
assert.ok(prerender.includes('qf-customer-sub'));
assert.ok(/pattern: '\/anuncie', anon: true/.test(src));
// Três textos que vão trocando; altura fixa para a tela não pular; respeita "reduzir movimento".
for(const t of ['Anuncie sua marca aqui','Sua empresa neste espaço','Quer aparecer aqui?'])assert.ok(src.includes("['"+t+"'"),t);
assert.ok(/\.qf-brandrot__copy \{[^}]*height: 64px/.test(src));
assert.ok(src.includes("prefers-reduced-motion: reduce"));
// Para de trocar quando a pessoa sai da tela inicial.
assert.ok(src.includes('if(!rot.isConnected){clearInterval(timer);return;}'));
console.log('home-carrossel-marca: posição, logo, botão dos planos e troca automática: ok');
