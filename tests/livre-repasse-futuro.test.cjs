const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const plan=require('../qf-livre.js');
const src=fs.readFileSync(path.join(__dirname,'../qf-livre.js'),'utf8');
test('Oferta Livre comunica benefício e condições sem prometer pagamento de serviços universal',()=>{
  const h=plan.oferta({ativo:false});
  assert.match(h,/QUEM FAZ LIVRE/);
  assert.match(h,/R\$ 39,90 por 30 dias/);
  assert.match(h,/menos de R\$ 1,50 por dia/i);
  assert.match(h,/desbloqueios ilimitados de pedidos compatíveis/i);
  assert.match(h,/Chat e WhatsApp do cliente após o desbloqueio/);
  assert.match(h,/Comissão de 13%/);
  assert.match(h,/Pagamentos de serviços pela plataforma, quando disponíveis para o pedido/);
  assert.doesNotMatch(h,/o repasse não é automático|saque garantido|Pix sempre disponível/i);
});
test('Cadastro mantém preço do Avulso e Livre e alternativa do teste sem checkout automático',()=>{
  assert.match(src,/Recarga mínima obrigatória.*R\$ 13,00/);
  assert.match(src,/R\$ 39,90 por 30 dias/);
  assert.match(src,/teste grátis de 48 horas/i);
  assert.match(src,/trialInput\.checked=true/);
  assert.match(src,/trialInput\)trialInput\.checked=false/);
  assert.match(src,/grupo|planos|checkout/i);
  assert.match(plan.oferta(),/Sem cobrança por contato/);
});
test('Oferta não acrescenta cobrança financeira por carregar a tela',()=>{
  const h=plan.oferta({ativo:true});
  assert.doesNotMatch(h,/data-qf-livre-pagar/);
  assert.match(h,/Ver pedidos disponíveis/);
  assert.match(h,/quando disponíveis/i);
  assert.match(h,/R\$ 39,90 por 30 dias/);
});
