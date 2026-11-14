const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../qf-atendimento.js');

test('qualificação exige faixa estimada sem alterar modalidade ou cobrança',()=>{
  const question=A.questions({servico:'Eletricista'}).find(q=>q.key==='orcamento_estimado');
  assert.ok(question);
  assert.ok(A.stages({servico:'Eletricista'})[2].questions.some(q=>q.key==='orcamento_estimado'));
  assert.match(A.validate(question,'',{}),/Responda/);
  assert.match(A.validate(question,'preco_livre',{}),/opções/);
  for(const [value] of question.choices)assert.equal(A.validate(question,value,{}),'');
  const answers={servico:'Eletricista',detalhes:'tomada',escopo:'um',cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'urgente',orcamento_estimado:'100_500',materiais:'cliente',nome:'Cliente',contato:'11988887777',intencao:'contratar',max_orcamentos:'4',autorizacao:'sim'};
  const payload=A.payload(answers,'11111111-1111-4111-8111-111111111111','eletricista');
  assert.equal(payload.estimativa_orcamento_cliente,'R$ 100 a R$ 500');
  assert.equal(payload.orcamento_faixa,'a combinar');
  assert.equal(payload.orcamento_centavos,null);
  assert.equal(payload.tipo,'tradicional');
  assert.match(A.validAll({...answers,orcamento_estimado:''}),/Responda/);
});
