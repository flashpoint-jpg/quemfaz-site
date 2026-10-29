const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=n=>fs.readFileSync(require('node:path').join(__dirname,'..',n),'utf8');
test('Página inicial distingue claramente quem contrata e quem oferece serviços',()=>{
 const s=read('qf-pedido-home.js');new vm.Script(s);
 assert.match(s,/Preciso contratar um profissional/);
 assert.match(s,/Quero oferecer meus serviços/);
 assert.match(s,/Ir para a área de profissionais/);
 assert.match(s,/data-nav="\/auth\/profissional\/login"/);
 assert.match(s,/Já publicou um pedido\?/);
 assert.ok(s.indexOf('data-home-problem')<s.indexOf('Já publicou um pedido?'),'Login aparece depois da descrição do pedido');
});
test('Conta de cliente sem pedido tem caminho para publicar; cadastro tem orientação',()=>{
 const s=read('qf-pedido-home.js'),access=read('qf-cliente-acesso.js');
 new vm.Script(access);
 assert.match(s,/Seu cadastro está pronto\. Falta publicar o pedido!/);
 assert.match(s,/Publicar meu primeiro pedido/);
 assert.match(s,/data-home-empty-orders/);
 assert.match(access,/Área do cliente/);
 assert.match(access,/Ir para cadastro de profissionais/);
});
