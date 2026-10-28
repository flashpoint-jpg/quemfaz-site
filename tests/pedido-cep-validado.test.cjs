const test=require('node:test');
const assert=require('node:assert/strict');
const A=require('../qf-atendimento.js');
test('CEP válido consulta endereço público e retorna cidade, UF e bairro',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async url=>{
  assert.equal(url,'https://viacep.com.br/ws/01001000/json/');
  return {ok:true,json:async()=>({cep:'01001-000',localidade:'São Paulo',uf:'SP',bairro:'Sé'})};
 };
 try{assert.deepEqual(await A.consultarCep('01001-000'),{cep:'01001000',cidade:'São Paulo',uf:'SP',bairro:'Sé'});}
 finally{globalThis.fetch=old;}
});
test('CEP inexistente ou inválido impede continuar com localização falsa',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({erro:true})});
 try{
  await assert.rejects(A.consultarCep('123'),/8 números/);
  await assert.rejects(A.consultarCep('99999999'),/não encontrado/);
 }finally{globalThis.fetch=old;}
});
test('CEP novo exige validação e substitui cidade e estado digitados',()=>{
 const a={__cepRequired:true,servico:'Pedreiro',__servicePrefilled:true,__problem:'rebocar parede',cep:'01001000',cidade:'Nome inventado',uf:'ZZ',bairro:'Nome falso'};
 const local=A.stages(a)[1].questions.map(q=>q.key);
 assert.deepEqual(local,['cep','bairro','urgencia']);
 assert.match(A.validate({key:'cep'},a.cep,a),/Confirme seu CEP/);
 a.__cepValidado='01001000';a.cidade='São Paulo';a.uf='SP';a.bairro='Sé';a.__bairroCep='Sé';
 assert.equal(A.validate({key:'cep'},a.cep,a),'');
 assert.equal(A.validate({key:'bairro'},'Bairro inventado',a).includes('CEP corresponde'),true);
});
test('CEP não obriga usuário a informar rua ou número e continua privado no payload',()=>{
 const a={__cepRequired:true,servico:'Pedreiro',__servicePrefilled:true,__problem:'rebocar parede',
  detalhes:'parede',escopo:'avaliar',cep:'01001000',__cepValidado:'01001000',cidade:'São Paulo',uf:'SP',
  bairro:'Sé',__bairroCep:'Sé',urgencia:'normal',materiais:'cliente',nome:'Cliente Teste',contato:'11988887777',
  aceite_app:'sim',intencao:'contratar',autorizacao:'sim'};
 const p=A.payload(a,'12345678-1234-4234-8234-123456789012','cat_pedreiro');
 assert.equal(p.cidade,'São Paulo');assert.equal(p.uf,'SP');assert.equal(p.bairro,'Sé');
 assert.match(p.detalhes,/rebocar parede/);
 assert.equal(Object.hasOwn(p,'cep'),false);
 assert.equal(Object.hasOwn(p,'logradouro'),false);
});
