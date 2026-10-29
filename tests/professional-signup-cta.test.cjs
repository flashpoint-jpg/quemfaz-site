const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','qf-pedido-home.js'),'utf8');
test('CTA de profissional tem classe independente do botão branco do cabeçalho',()=>{
 assert.match(src,/class="qf-empty-prof-cta" data-qf-professional-signup/);
 assert.doesNotMatch(src,/class="btn btn--outline qf-home-prof-btn" data-nav="\/auth\/profissional\/login">Sou profissional/);
});
test('CTA de profissional vai ao cadastro profissional, sem abrir pedidos do cliente',()=>{
 assert.match(src,/e\.target\.closest\('\[data-qf-professional-signup\]'\)/);
 assert.match(src,/originalNavigate\.call\(g,'\/auth\/profissional\/cadastro'\)/);
});
test('CTA no estado sem pedidos é legível e permite toque no celular',()=>{
 assert.match(src,/#qf-pedido-facil \[data-home-empty-orders\] \.qf-empty-prof-cta\{[^}]*min-height:52px/);
 assert.match(src,/#qf-pedido-facil \[data-home-empty-orders\] \.qf-empty-prof-cta\{[^}]*color:#143f74/);
 assert.match(src,/#qf-pedido-facil \[data-home-empty-orders\] \.qf-empty-prof-cta:focus-visible/);
});
