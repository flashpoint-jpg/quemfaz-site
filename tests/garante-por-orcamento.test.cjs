const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../qf-atendimento.js');
const {uid,answers,db,as,pub,unlock,scalar}=require('./helpers/atendimento-db.cjs');
const migration=fs.readFileSync('supabase/migrations/20261022142812_garante_por_orcamento.sql','utf8');
async function upgrade(d){await d.exec('reset role');await d.exec('alter table public.qf_chamados add column if not exists valor_oferecido_centavos integer');await d.exec(migration);await as(d,1);}

test('orçamento define modalidade, inclusive faixa até 500 e materiais a combinar',()=>{
 for(const orcamento of ['0:50000','50000:150000','500']){
  const a={orcamento,materiais:'combinar',intencao:'pesquisando',tipo:'tradicional'};
  assert.equal(A.tipoPorOrcamento(a),'garante');
  assert.ok(!A.questions(a).some(q=>['tipo','qualificacao'].includes(q.key)));
 }
 for(const orcamento of ['avaliacao','a combinar',undefined,'abc'])assert.equal(A.tipoPorOrcamento({orcamento}),'tradicional');
 const a={servico:'Pedreiro',detalhes:'reparo',escopo:'pequena',cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'normal',data:'2099-10-22',disponibilidade:'Manhã',nome:'Cliente',contato:'11988887777',autorizacao:'sim',intencao:'contratar',materiais:'combinar',orcamento:'0:50000',tipo:'tradicional'};
 assert.equal(A.payload(a,uid(200),'pintor').tipo,'garante');
 assert.equal(A.payload({...a,orcamento:'avaliacao',tipo:'garante'},uid(201),'pintor').tipo,'tradicional');
});

test('servidor ignora escolha antiga, faixa mantém limite e não inventa autorização',async()=>{
 const d=await db();try{
  await upgrade(d);
  const a=answers({orcamento_centavos:null,orcamento_faixa:'0:50000',materiais:'combinar',qualificacao:null,tipo:'tradicional'});
  const r=await pub(d,a);
  assert.equal(r.atendimento_tipo,'garante');assert.equal(r.max_orcamentos,1);
  assert.equal(r.orcamento_aproximado_centavos,null);assert.match(r.descricao,/Até R\$ 500,00/);
  assert.equal((await pub(d,a)).id,r.id);
  assert.equal((await pub(d,{...a,chave:uid(201),tipo:'garante'})).id,r.id);
  const saved=await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`);
  assert.equal(saved.tipo,'garante');assert.equal(saved.autorizacao,'sim');assert.equal(saved.qualificacao,undefined);
  await assert.rejects(pub(d,{...a,chave:uid(203),autorizacao:'nao'}),/sem_autorizacao/);
  await as(d,11);assert.equal((await unlock(d,r.id)).reason,'garante_exige_exclusivo');
  const paid=await unlock(d,r.id,true);assert.equal(paid.ok,true);assert.equal(paid.preco_centavos,4000);
  await as(d,12);assert.equal((await unlock(d,r.id,true)).ok,false);
  await d.exec('reset role');assert.equal(await scalar(d,`select count(*) from public.qf_movimentacoes_carteira where referencia_id='${r.id}'`),1);
 }finally{await d.close();}
});

test('avaliação sem valor permanece tradicional e aceita quatro desbloqueios',async()=>{
 const d=await db();try{
  await upgrade(d);
  const r=await pub(d,answers({tipo:'garante',orcamento_centavos:null,orcamento_faixa:'avaliacao'}));
  assert.equal(r.atendimento_tipo,'tradicional');assert.equal(r.max_orcamentos,4);
  for(let i=11;i<=14;i++){await as(d,i);assert.equal((await unlock(d,r.id)).ok,true);}
  await as(d,15);assert.equal((await unlock(d,r.id)).ok,false);
 }finally{await d.close();}
});

test('migração classifica abertos por valor/faixa e preserva desbloqueados, cancelados e respostas históricas',async()=>{
 const d=await db();try{
  const open=await pub(d,answers({materiais:'combinar',orcamento_centavos:null,orcamento_faixa:'0:50000'}));
  const paid=await pub(d,answers({chave:uid(201),detalhes:'Pintar outra sala'}));
  await as(d,11);assert.equal((await unlock(d,paid.id)).ok,true);
  await as(d,1);const cancelled=await pub(d,answers({chave:uid(202),detalhes:'Pintar outra porta'}));
  await d.query("update public.qf_chamados set status='cancelado' where id=$1",[cancelled.id]);
  await d.exec('reset role');
  await d.query('update public.qf_chamados set orcamento_aproximado_centavos=50000 where id=$1',[uid(100)]);
  const ledger=await scalar(d,'select count(*) from public.qf_movimentacoes_carteira');
  await upgrade(d);
  await d.exec('reset role');
  assert.equal(await scalar(d,`select atendimento_tipo from public.qf_chamados where id='${open.id}'`),'garante');
  assert.equal(await scalar(d,`select atendimento_tipo from public.qf_chamados where id='${uid(100)}'`),'garante');
  assert.equal(await scalar(d,`select max_orcamentos from public.qf_chamados where id='${uid(100)}'`),1);
  for(const id of [paid.id,cancelled.id])assert.equal(await scalar(d,`select atendimento_tipo from public.qf_chamados where id='${id}'`),'tradicional');
  assert.equal(await scalar(d,`select respostas->>'tipo' from private.qf_atendimentos where chamado_id='${open.id}'`),'tradicional');
  assert.equal(await scalar(d,'select count(*) from public.qf_movimentacoes_carteira'),ledger);
  await as(d,1);assert.equal((await pub(d,answers({materiais:'combinar',orcamento_centavos:null,orcamento_faixa:'0:50000'}))).id,open.id);
  await assert.rejects(d.query("update public.qf_chamados set atendimento_tipo='tradicional' where id=$1",[open.id]),/atendimento_imutavel/);
 }finally{await d.close();}
});
