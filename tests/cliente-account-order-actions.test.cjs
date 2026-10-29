const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../qf-pedido-home.js'),'utf8');

test('Cliente autenticado não recebe botão Meus pedidos duplicado na barra do histórico',()=>{
 assert.ok(src.includes("const showActions=inHistory&&(!state.account||state.mode!=='orders');"));
 assert.ok(src.includes("(!state.account?'<button type=\"button\" class=\"btn btn--outline\" data-home-orders>Meus pedidos</button>':'')"));
});

test('Histórico com pedidos mostra Novo pedido e histórico vazio conserva CTA principal',()=>{
 assert.ok(src.includes('data-home-new>+ Novo pedido</button>'));
 assert.ok(src.includes('data-home-empty-orders'));
 assert.ok(src.includes('data-home-new>Publicar meu primeiro pedido</button>'));
});

test('Botão profissional tem classe própria e contraste adequado',()=>{
 assert.ok(src.includes('class="qf-empty-prof-cta" data-qf-professional-signup'));
 assert.match(src,/#qf-pedido-facil \[data-home-empty-orders\] \.qf-empty-prof-cta\{[^}]*color:#143f74/);
});
