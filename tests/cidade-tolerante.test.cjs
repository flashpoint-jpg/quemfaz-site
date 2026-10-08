// V11.38: o campo "Cidade" do pedido entende o jeito que o cliente escreve e não trava no estado (UF).
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync('qf-location-autocomplete.js','utf8'),context);
const api=context.window.QFLocationAutocomplete,data=JSON.parse(fs.readFileSync('data/localidades.json'));
const lido=(q,uf)=>{const r=api.guessRegion(data,q,uf);return r?r.cidade+'/'+r.uf:null;};
const lista=q=>Array.from(api.suggestRegions(data,q),c=>c[1]+'/'+c[2]);
const html=fs.readFileSync('index.html','utf8');

test('aceita sozinho as formas comuns de escrever a cidade',()=>{
 for(const q of ['São Paulo','sao paulo','sao paulo sp','São Paulo - SP','São Paulo capital','SP','Sao Palo'])assert.equal(lido(q),'São Paulo/SP',q);
 assert.equal(lido('Santo André'),'Santo André/SP');
 assert.equal(lido('santo andre sp'),'Santo André/SP');
 assert.equal(lido('Guarulos'),'Guarulhos/SP');
 assert.equal(lido('poá sp'),'Poá/SP');
});
test('estado escrito ou escolhido pelo cliente é respeitado',()=>{
 assert.equal(lido('Santo André / PB'),'Santo André/PB');
 assert.equal(lido('Santo André','PB'),'Santo André/PB');
 assert.equal(lido('rio de janeiro rj'),'Rio de Janeiro/RJ');
 assert.equal(lido('Lapa','PR'),'Lapa/PR');
 assert.equal(lido('São Paulo','RJ'),null);
 assert.equal(lido('SP','SP'),'São Paulo/SP');
 assert.equal(lido('sao paulo sp','SP'),'São Paulo/SP');
});
test('bairro da capital escrito no campo da cidade não vira cidade de outro estado em silêncio',()=>{
 for(const q of ['Lapa','Penha','Liberdade','Santo Amaro','Ipiranga','Pinheiros','Bela Vista','São Mateus','Grajaú','Itaquera','Mooca','Tatuapé','Santana','Butantã','Pirituba','Jabaquara','Capão Redondo','Centro','zona leste']){
  assert.equal(lido(q),null,q);
  assert.ok(lista(q).includes('São Paulo/SP'),q+' oferece a capital');
 }
 assert.deepEqual(lista('Lapa'),['Lapa/PR','São Paulo/SP']);
});
test('a lista de correção traz a cidade provável e nunca fica vazia',()=>{
 assert.equal(lista('Taboão')[0],'Taboão da Serra/SP');
 assert.equal(lista('São Bernardo')[0],'São Bernardo do Campo/SP');
 assert.equal(lista('Rio de Janeiro')[0],'Rio de Janeiro/RJ');
 assert.deepEqual(lista('xyzabc'),['São Paulo/SP']);
 for(const q of ['x','rj','???','Itaquá','Embu'])assert.ok(lista(q).length>=1&&lista(q).length<=5,q);
});
test('a regra antiga (exactRegion) continua igual para as outras telas',()=>{
 assert.equal(api.exactRegion(data,'Santo André'),null);
 assert.equal(api.exactRegion(data,'sao paulo').uf,'SP');
});
test('pedido usa a leitura tolerante, mantém o bairro digitado e não deixa aviso antigo na tela',()=>{
 const bind=html.slice(html.indexOf('sugestoesPedido = global.QFLocationAutocomplete.bind('),html.indexOf('const telefoneInput = form.querySelector'));
 assert.match(bind,/tolerant: true/);assert.match(bind,/keepBairro: true/);assert.match(bind,/onPick:/);
 const envio=html.slice(html.indexOf("form.addEventListener('submit', async function (e) {",html.indexOf('V11.37: pedido em 2 etapas')));
 assert.ok(envio.indexOf("querySelectorAll('[data-qf-validation-for]')")<envio.indexOf('resolveRegion('),'limpa avisos antes de validar');
 assert.ok(envio.indexOf('sugestoesPedido.hasOptions()')<envio.indexOf("showFieldError('uf'"),'lista de cidades vem antes do erro de UF');
 const js=fs.readFileSync('qf-location-autocomplete.js','utf8');
 assert.match(js,/if\(!options\.keepBairro\)bairroInput\.value=''/);
 assert.match(html,/qf-location-autocomplete\.js\?v=11\.38\.0/);
});
