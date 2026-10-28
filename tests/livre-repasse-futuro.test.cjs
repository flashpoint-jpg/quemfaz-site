const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const plan=require('../qf-livre.js');
const src=fs.readFileSync(path.join(__dirname,'../qf-livre.js'),'utf8');
test('Somente oferta Quem Faz Livre anuncia futuro repasse, claramente não disponível',()=>{
  const h=plan.oferta({ativo:false});
  assert.match(h,/QUEM FAZ LIVRE/);
  assert.match(h,/Em preparação: cliente paga após o serviço e você recebe 87% na sua chave Pix/);
  assert.match(h,/Esta opção ainda não está disponível/);
  assert.match(h,/após a confirmação bancária/i);
  assert.match(h,/13%/);
  assert.match(h,/Regra vigente/);
});
test('Cadastro do Livre distingue repasse planejado da modalidade atual',()=>{
  assert.match(src,/envio de 87% à sua chave Pix após confirmação bancária/);
  assert.match(src,/funcionalidade em preparação, ainda indisponível/);
  assert.match(src,/O novo modelo ainda não está disponível/);
  assert.match(src,/Sem pagar por contato/);
});
test('Nenhuma chamada de pagamento ou nova autorização bancária é adicionada à oferta',()=>{
  const html=plan.oferta({ativo:true});
  assert.doesNotMatch(html,/data-qf-livre-pagar/);
  assert.match(html,/Ver pedidos disponíveis/);
  assert.match(html,/Em preparação/);
  assert.match(html,/R\$ 39,90 por 30 dias/);
});
