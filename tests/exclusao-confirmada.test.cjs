const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {test} = require('node:test');
const source = fs.readFileSync('admin.html','utf8');
const start = source.indexOf('excluirChamados: async function(ids)');
const end = source.indexOf('\n    excluirUsuario:', start);
const code = '({' + source.slice(start,end) + '})';
function make(responses) {
  const calls = [];
  const client = {rpc: async (name, args) => { calls.push({name,args}); return responses.shift(); }};
  return {fn: vm.runInNewContext(code,{client}).excluirChamados,calls};
}
test('exclusão só confirma após consultar o banco e verificar ausência',async()=>{
  const {fn,calls}=make([{data:1},{data:{chamados:[{id:'outro'}]}}]);
  assert.equal(await fn(['pedido','pedido']),1);
  assert.equal(calls[0].name,'qf_admin_excluir_chamados');
  assert.equal(calls[0].args.p_ids.length,1);
  assert.equal(calls[1].name,'qf_admin_snapshot');
});
test('pedido que continua no banco não recebe confirmação',async()=>{
  const {fn}=make([{data:0},{data:{chamados:[{id:'pedido'}]}}]);
  await assert.rejects(fn(['pedido']),/continuam no banco/);
});
test('falha de consulta e resposta incompleta impedem confirmação',async()=>{
  for(const response of [{error:{message:'offline'}},{data:{}}]){
    const {fn}=make([{data:1},response]);
    await assert.rejects(fn(['pedido']),/confirm/);
  }
});
test('erro na exclusão é preservado e zero não vira contagem falsa',async()=>{
  let {fn}=make([{error:new Error('sem_permissao')}]);
  await assert.rejects(fn(['pedido']),/sem_permissao/);
  ({fn}=make([{data:0},{data:{chamados:[]}}]));
  assert.equal(await fn(['pedido']),0);
  assert.ok(!source.includes("(n || ids.length) + ' serviço(s) excluído(s).'"));
});
test('botão Excluir da cascata usa exclusão real, Limpar lista fica explícito',()=>{
  assert.ok(source.includes('if (ids) await global.QFAdminCloud.excluirChamados(ids);'));
  assert.ok(source.includes('Confirmar exclusão do banco'));
  assert.ok(source.includes('Lista limpa no painel; os pedidos continuam ativos.'));
});
for (const [i,match] of [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) new vm.Script(match[1],{filename:'admin-inline-'+i});
