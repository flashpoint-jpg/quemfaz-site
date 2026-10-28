const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../qf-atendimento.js');
const {uid,answers,db,as,pub,unlock,scalar}=require('./helpers/atendimento-db.cjs');
const prior=fs.readFileSync('supabase/migrations/20261022142812_garante_por_orcamento.sql','utf8');
const current=fs.readFileSync('supabase/migrations/20261022144845_garante_apenas_novos_com_intencao.sql','utf8');
async function apply(d,sql){await d.exec('reset role');await d.exec('alter table public.qf_chamados add column if not exists valor_oferecido_centavos integer');await d.exec(sql);await as(d,1);}

test('novo Garante exige valor e intenção; preço pesquisado e avaliação ficam tradicionais',async()=>{
 const d=await db();try{
  await apply(d,prior);await apply(d,current);
  const conditions=[
   {orcamento_centavos:null,orcamento_faixa:'0:50000',intencao:'contratar',expected:'garante',front:'0:50000'},
   {orcamento_centavos:50000,intencao:'contratar',expected:'garante',front:'500'},
   {orcamento_centavos:null,orcamento_faixa:'0:50000',intencao:'pesquisando',expected:'tradicional',front:'0:50000'},
   {orcamento_centavos:50000,intencao:'pesquisando',expected:'tradicional',front:'500'},
   {orcamento_centavos:null,orcamento_faixa:'avaliacao',intencao:'contratar',expected:'tradicional',front:'avaliacao'}
  ];
  for(const [i,{expected,front,...changes}] of conditions.entries()){
   assert.equal(A.tipoPorOrcamento({orcamento:front,intencao:changes.intencao}),'tradicional','o formulário atual não promove pedidos a exclusivo; a migração histórica abaixo mantém seu contrato');
   const a=answers({...changes,chave:uid(300+i),detalhes:'Pintar parede número '+i,materiais:'combinar',tipo:expected==='garante'?'tradicional':'garante'});
   const r=await pub(d,a);assert.equal(r.atendimento_tipo,expected);assert.equal(r.max_orcamentos,expected==='garante'?1:4);
   assert.equal((await pub(d,a)).id,r.id);
   if(expected==='garante'){await as(d,11);const p=await unlock(d,r.id,true);assert.equal(p.ok,true);assert.equal(p.preco_centavos,4000);await as(d,1);}
  }
 }finally{await d.close();}
});

test('antigos voltam ao tradicional, não se promovem ao editar e desbloqueados ficam intactos',async()=>{
 const d=await db();try{
  const old=await pub(d);
  const paid=await pub(d,answers({chave:uid(201),detalhes:'Pintar uma porta antiga'}));
  await as(d,11);await unlock(d,paid.id);await d.exec('reset role');
  await d.exec(`update public.qf_chamados set criado_em='2026-10-21 12:00:00+00' where id in ('${old.id}','${paid.id}')`);
  await apply(d,prior);
  await d.exec('reset role');
  assert.equal(await scalar(d,`select atendimento_tipo from public.qf_chamados where id='${old.id}'`),'garante');
  const before=await scalar(d,`select to_jsonb(c)::text from public.qf_chamados c where id='${paid.id}'`);
  const ledger=await scalar(d,'select count(*) from public.qf_movimentacoes_carteira');
  await apply(d,current);
  await d.exec('reset role');assert.equal(await scalar(d,`select to_jsonb(c)::text from public.qf_chamados c where id='${paid.id}'`),before);
  assert.equal(await scalar(d,'select count(*) from public.qf_movimentacoes_carteira'),ledger);
  const r=(await d.query('select * from public.qf_chamados where id=$1',[old.id])).rows[0];
  assert.equal(r.atendimento_tipo,'tradicional');assert.equal(r.max_orcamentos,4);
  await d.query("update public.qf_chamados set titulo='Título editado' where id=$1",[old.id]);
  assert.equal(await scalar(d,`select atendimento_tipo from public.qf_chamados where id='${old.id}'`),'tradicional');
  await as(d,1);assert.equal((await pub(d)).id,old.id);
  await assert.rejects(d.query("update public.qf_chamados set atendimento_tipo='garante' where id=$1",[old.id]),/atendimento_imutavel/);
  await d.exec('reset role');assert.equal(await scalar(d,"select tgenabled from pg_trigger where tgname='qf_zz_atendimento_guard'"),'O');
 }finally{await d.close();}
});
