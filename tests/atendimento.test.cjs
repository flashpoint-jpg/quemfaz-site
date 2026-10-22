const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../qf-atendimento.js');
const {uid,answers,db,as,pub,unlock,scalar}=require('./helpers/atendimento-db.cjs');
test('atendimento: adapta perguntas e valida todas antes da publicação',()=>{
 assert.match(A.questions({servico:'Faxina'})[2].label,/m²/);
 assert.match(A.questions({servico:'Eletricista'})[2].label,/equipamentos/);
 assert.match(A.questions({servico:'Montador de móveis'})[2].label,/peças/);
 assert.equal(A.budget('1.500,90'),150090);assert.equal(A.budget('a combinar'),null);assert.ok(Number.isNaN(A.budget('abc')));
 const a={servico:'Faxina',detalhes:'Limpeza de sala comercial',escopo:'51 a 100 m²',cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'urgente',orcamento:'300',materiais:'profissional',data:'2099-10-22',disponibilidade:'Manhã',nome:'Cliente Teste',contato:'11988887777',intencao:'contratar',autorizacao:'sim',tipo:'garante',qualificacao:'sim'};
 assert.equal(A.validAll(a),'');assert.equal(A.payload(a,uid(200),'faxina').orcamento_centavos,30000);
 assert.match(A.validAll({...a,autorizacao:'nao'}),/Sem autorização/);
 assert.match(A.validAll({...a,orcamento:'a combinar'}),/Garante/);
 assert.match(A.validAll({...a,intencao:'pesquisando'}),/Garante/);
 assert.match(A.validAll({...a,materiais:'combinar'}),/Garante/);
});
test('banco: obrigatório, sem autorização e respostas incompletas não criam pedidos nem notificações',async()=>{
 const d=await db();try{
 for(const a of [answers({autorizacao:'nao'}),answers({escopo:''}),answers({orcamento_centavos:-1}),answers({data:'2000-01-01'}),answers({tipo:'garante',qualificacao:'nao'}),answers({contato:'11900001111'}),answers({detalhes:'Ligar para 11977776666'}),answers({detalhes:'Pintura na Rua teste 20'})])await assert.rejects(pub(d,a));
 await assert.rejects(d.query("insert into public.qf_chamados(cliente_id,categoria) values($1,'pintor')",[uid(1)]),/atendimento_obrigatorio/);
 await as(d,0);await assert.rejects(pub(d),/permission denied/);
 await d.exec('reset role');assert.equal(await scalar(d,'select count(*) from private.test_dispatch'),0);
 }finally{await d.close();}
});
test('banco: tradicional tem 4 vagas, Garante exige verificação, 4× exato e nunca usa plano',async()=>{
 const d=await db();try{
 const normal=await pub(d);assert.equal(normal.max_orcamentos,4);
 for(let i=11;i<=14;i++){await as(d,i);assert.equal((await unlock(d,normal.id)).ok,true);}
 await as(d,15);assert.equal((await unlock(d,normal.id)).ok,false);
 await as(d,1);const g=await pub(d,answers({chave:uid(201),tipo:'garante',qualificacao:'sim',detalhes:'Pintar outra sala comercial'}));
 assert.equal(g.max_orcamentos,1);
 await as(d,16);assert.equal((await unlock(d,g.id,true)).reason,'garante_exige_verificacao');
 await as(d,11);assert.equal((await unlock(d,g.id,false)).reason,'garante_exige_exclusivo');
 await d.exec('reset role');await d.exec(`insert into public.qf_planos_profissional(profissional_id,chamados_restantes,valido_ate) values('${uid(11)}',10,now()+interval '30 days');`);
 await as(d,11);const r=await unlock(d,g.id,true);assert.equal(r.ok,true);assert.equal(r.preco_centavos,4000);assert.equal(r.origem,'saldo');
 assert.equal((await unlock(d,g.id,true)).already_unlocked,true);
 await as(d,12);assert.equal((await unlock(d,g.id,true)).ok,false);
 await d.exec('reset role');assert.equal(await scalar(d,`select chamados_restantes from public.qf_planos_profissional where profissional_id='${uid(11)}'`),10);
 assert.equal(await scalar(d,`select count(*) from public.qf_movimentacoes_carteira where referencia_id='${g.id}'`),1);
 await d.exec(`update public.qf_desbloqueios set ativo=false where chamado_id='${g.id}'`);
 await as(d,12);assert.equal((await unlock(d,g.id,true)).reason,'reservado');
 }finally{await d.close();}
});
test('banco: retry e nova chave equivalente retornam mesmo pedido e disparam um único evento',async()=>{
 const d=await db();try{
 const a=answers();const first=await pub(d,a);assert.equal((await pub(d,a)).id,first.id);
 assert.equal((await pub(d,answers({chave:uid(201)}))).id,first.id);
 await assert.rejects(pub(d,answers({chave:uid(202),tipo:'garante',qualificacao:'sim'})),/pedido_duplicado_com_outros_dados/);
 await assert.rejects(pub(d,answers({detalhes:'Outro pedido diferente'})),/chave_reutilizada/);
 await d.exec('reset role');assert.equal(await scalar(d,'select count(*) from private.test_dispatch'),1);
 assert.equal(await scalar(d,'select count(*) from public.qf_chamados'),2); // 1 legacy + 1 new
 }finally{await d.close();}
});
test('banco: PII privada antes do desbloqueio, acesso do titular/admin, preserva legado e seu pagamento',async()=>{
 const d=await db();try{
 const r=await pub(d);assert.equal(r.atendimento_tipo,'tradicional');assert.doesNotMatch(r.descricao,/11988887777|Cliente Teste/);
 assert.equal((await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`)).nome,'Cliente Teste');
 await as(d,11);assert.equal(await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`),null);
 await assert.rejects(d.query('select * from private.qf_atendimentos'),/permission denied/);
 assert.equal((await d.query('select * from public.qf_chamados where id=$1',[r.id])).rows.length,0);
 await unlock(d,r.id);
 assert.equal((await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`)).contato,'11988887777');
 await as(d,12);assert.equal(await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`),null);
 await d.exec('reset role');await d.exec("select set_config('test.admin','true',false)");
 assert.equal((await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`)).nome,'Cliente Teste');
 await d.exec("select set_config('test.admin','false',false)");
 await as(d,1);await d.query("update public.qf_chamados set status='aguardando_pagamento' where id=$1",[uid(100)]);
 await d.query("update public.qf_chamados set status='aberto',prioridade=true where id=$1",[uid(100)]);
 await as(d,11);assert.equal((await unlock(d,uid(100))).ok,true);
 await d.exec('reset role');
 assert.equal(await scalar(d,`select atendimento_id is null from public.qf_chamados where id='${uid(100)}'`),true);
 }finally{await d.close();}
});

test('banco: preparação da implantação mantém legado até o corte explícito; depois obriga atendimento',async()=>{
 const d=await db();try{
 await d.exec('reset role');await d.exec(`insert into public.qf_config(chave,valor) values('atendimento_obrigatorio','{"ativo":false}')`);
 await as(d,1);await d.query("insert into public.qf_chamados(cliente_id,categoria,descricao) values($1,'pintor','Legado durante preparação')",[uid(1)]);
 await d.exec('reset role');await d.exec(`update public.qf_config set valor='{"ativo":true}' where chave='atendimento_obrigatorio'`);
 await as(d,1);await assert.rejects(d.query("insert into public.qf_chamados(cliente_id,categoria) values($1,'pintor')",[uid(1)]),/atendimento_obrigatorio/);
 assert.equal((await pub(d)).atendimento_tipo,'tradicional');
 }finally{await d.close();}
});

test('banco: geocodificador indisponível usa referência da cidade; cidade sem referência não vira pedido invisível',async()=>{
 const d=await db();try{
 await assert.rejects(d.query('select public.qf_publicar_atendimento($1::jsonb)',[JSON.stringify(answers())]),/localizacao_indisponivel/);
 await d.exec('reset role');await d.exec("insert into public.qf_cidades_coord values('santoandre','SP','Santo André',-23.6639,-46.5383)");
 await as(d,1);const r=(await d.query('select public.qf_publicar_atendimento($1::jsonb) r',[JSON.stringify(answers())])).rows[0].r;
 assert.equal(Number(r.latitude),-23.66);assert.equal(Number(r.longitude),-46.54);
 assert.equal(r.geo_precisao,'cidade');
 }finally{await d.close();}
});
