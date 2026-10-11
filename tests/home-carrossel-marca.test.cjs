// V11.72: mini carrossel "Anuncie sua marca aqui" abaixo da foto da tela inicial, com botão para os planos.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const html=fs.readFileSync(path.join(root,'dist/index.html'),'utf8');
// Já vem pronto no HTML inicial, depois da foto e antes do campo de busca.
const foto=html.indexOf('class="qf-landing-photo"'),rot=html.indexOf('data-brandrot'),form=html.indexOf('data-landing-service-form');
assert.ok(foto>0&&rot>foto&&form>rot,'ordem: foto, carrossel, campo');
// Mostra o logo do QuemFaz e leva para a tela de planos de divulgação, que abre sem login.
const bloco=html.slice(rot,form);
assert.ok(bloco.includes('qf-brandmark')&&bloco.includes('Anuncie sua marca aqui'));
assert.ok(/class="qf-brandrot__cta"[^>]*data-nav="\/anuncie"/.test(bloco));
assert.ok(/pattern: '\/anuncie', anon: true/.test(src));
// Três textos que vão trocando; altura fixa para a tela não pular; respeita "reduzir movimento".
for(const t of ['Anuncie sua marca aqui','Sua empresa neste espaço','Quer aparecer aqui?'])assert.ok(src.includes("['"+t+"'"),t);
assert.ok(/\.qf-brandrot__copy \{[^}]*height: 64px/.test(src));
assert.ok(src.includes("prefers-reduced-motion: reduce"));
// Para de trocar quando a pessoa sai da tela inicial.
assert.ok(src.includes('if(!rot.isConnected){clearInterval(timer);return;}'));
console.log('home-carrossel-marca: posição, logo, botão dos planos e troca automática: ok');
