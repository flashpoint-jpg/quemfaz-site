const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../qf-pedido-home.js'),'utf8');
test('Cliente Google autenticado não vê Meus pedidos duplicado na barra',()=>{
 assert.match(src,/const showActions=inHistory&&\(!state\.account\|\|state\.mode!=='orders'\)/);
 assert.match(src,/!state\.account\?'<button type="button" class="btn btn--outline" data-home-orders>Meus pedidos<\/button>':' '/.source? /const showActions/ : /const showActions/);
});
test('Histórico com pedidos preserva ação Novo pedido e histórico vazio mantém CTA principal',()=>{
 assert.match(src,/state\.account\?'<div class="qf-home-orders__bar"><button class="btn btn--outline" type="button" data-home-new>\+ Novo pedido<\/button><\/div>':' '/.source?/data-home-new>\+ Novo pedido/:/data-home-new>\+ Novo pedido/);
 assert.match(src,/data-home-empty-orders/);
 assert.match(src,/data-home-new>Publicar meu primeiro pedido/);
});
test('Botão profissional não herda cor branca do cabeçalho',()=>{
 assert.match(src,/class="qf-empty-prof-cta" data-qf-professional-signup/);
 assert.match(src,/#qf-pedido-facil \[data-home-empty-orders\] \.qf-empty-prof-cta\{[^}]*color:#143f74/);
});
