
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8');

test('Regras Pix Livre e Avulso no acompanhamento e cards legíveis',()=>{
 const owner=read('qf-acompanhamento.js'),pro=read('qf-comissao13.js');
 new vm.Script(owner);new vm.Script(pro);
 assert.match(owner,/data-qf-payment-rules/);
 assert.match(owner,/Pix emitido pelo Quem Faz/);
 assert.match(owner,/Avulso/);
 assert.match(owner,/data-qf-livre-rule/);
 assert.match(owner,/Não pague diretamente ao profissional/);
 assert.match(pro,/data-qf13-abrir>Fechei<\/button>/);
 assert.match(pro,/data-qf13-negociando>Negociando<\/button>/);
 assert.match(pro,/data-qf13-recusado>Não fechei<\/button>/);
 assert.match(pro,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(pro,/O cliente pode confirmar sem passar código/);
});

test('Nenhum Pix deve surgir quando o backend ainda não estiver homologado',()=>{
 const src=read('qf-acompanhamento.js');
 assert.match(src,/if\(!d\.disponivel&&d\.status==='nao_iniciado'\)/);
 assert.match(src,/está em preparação/);
 assert.match(src,/não transfira valores por fora/);
});
