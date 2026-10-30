const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const plan=require('../qf-livre.js');
const src=fs.readFileSync('qf-livre.js','utf8');
test('Novos planos exibem cotas, valores e não prometem comissão nem repasse universal',()=>{
 const h=plan.oferta({ativo:false});
 assert.match(h,/PLANOS QUEM FAZ/);
 assert.match(h,/R\$ 39,90/);
 assert.match(h,/R\$ 79,90/);
 assert.match(h,/R\$ 149,90/);
 assert.match(h,/10 desbloqueios/);
 assert.match(h,/25 desbloqueios/);
 assert.match(h,/100 desbloqueios/);
 assert.doesNotMatch(h,/Comissão de 13%/);
 assert.match(h,/confirmação bancária/);
 assert.doesNotMatch(h,/Pix sempre disponível|saque garantido/i);
});
test('Cadastro exige pagamento e não oferece teste grátis como entrada',()=>{
 assert.match(src,/PAGAMENTO OBRIGATÓRIO PARA ATIVAR O CADASTRO/);
 assert.match(src,/Recarga mínima obrigatória/);
 assert.doesNotMatch(src,/data-qf-opcao="trial"/);
 assert.match(src,/data-qf-opcao=/);
});
test('Exibir oferta não cria cobrança automaticamente',()=>{
 const h=plan.oferta({ativo:true});
 assert.match(h,/Ver pedidos disponíveis/);
 assert.match(h,/Pagar R\$ 39,90 por Pix/);
 assert.doesNotMatch(h,/data-qf-livre-pagar/);
});
