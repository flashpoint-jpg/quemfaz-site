const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const A=require('../qf-atendimento.js');
const {uid,answers,db,as,pub,unlock,scalar}=require('./helpers/atendimento-db.cjs');
test('atendimento: adapta perguntas e valida todas antes da publicação',()=>{
 assert.ok(A.questions({servico:'Faxina'})[1].choices.some(c=>c[0]==='comum'));
 assert.ok(A.questions({servico:'Eletricista'})[1].choices.some(c=>c[0]==='tomada'));
 assert.ok(A.questions({servico:'Montador de móveis'})[1].choices.some(c=>c[0]==='montagem'));
 assert.equal(A.budget('1.500,90'),150090);assert.equal(A.budget('a combinar'),null);assert.ok(Number.isNaN(A.budget('abc')));
 const a={servico:'Faxina',detalhes:'comum',escopo:'3a4',cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'normal',orcamento:'15000:30000',materiais:'profissional',data:'2099-10-22',disponibilidade:'Manhã',nome:'Cliente Teste',contato:'11988887777',intencao:'contratar',autorizacao:'sim',tipo:'garante',qualificacao:'sim'};
 assert.equal(A.validAll(a),'');assert.equal(A.payload(a,uid(200),'faxina').orcamento_centavos,null);
 assert.match(A.validAll({...a,autorizacao:'nao'}),/Sem autorização/);
 assert.equal(A.validAll({...a,orcamento:'avaliacao',tipo:'tradicional'}),'');assert.ok(!A.stages({...a,orcamento:'avaliacao'} )[3].questions.some(q=>q.key==='tipo'));
 assert.ok(!A.stages({...a,intencao:'pesquisando'})[3].questions.some(q=>q.key==='tipo'));
 assert.ok(!A.stages({...a,materiais:'combinar'})[3].questions.some(q=>q.key==='tipo'));
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

test('quatro etapas: avaliação sem preço, faixas por profissão e materiais pertinentes',()=>{
 const a={servico:'Faxina',detalhes:'comum',escopo:'3a4',cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'normal',orcamento:'avaliacao',materiais:'combinar',data:'2099-10-22',disponibilidade:'Manhã',nome:'Cliente Teste',contato:'11988887777',intencao:'contratar',autorizacao:'sim',tipo:'tradicional'};
 assert.equal(A.stages(a).length,4);
 assert.equal(A.validAll(a),'');assert.equal(A.payload(a,uid(200),'faxina').orcamento_centavos,null);
 assert.equal(A.payload(a,uid(200),'faxina').orcamento_faixa,'avaliacao');
 assert.notDeepEqual(A.budgetChoices('Faxina'),A.budgetChoices('Pedreiro'));
 assert.notDeepEqual(A.budgetChoices('Faxina'),A.budgetChoices('Eletricista'));
 for(const servico of ['Faxina','Pedreiro','Eletricista']){
  for(const [orcamento] of A.budgetChoices(servico))assert.equal(A.validAll({...a,servico,detalhes:servico==='Faxina'?'comum':servico==='Pedreiro'?'reparo':'tomada',orcamento}),'');
 }
 assert.equal(A.validAll({...a,servico:'Professor',detalhes:'instalacao',materiais:undefined}),'');
 assert.equal(A.payload({...a,servico:'Professor',detalhes:'instalacao',materiais:undefined},uid(200),'professor').materiais,'nao_aplica');
 assert.equal(A.validAll({...a,urgencia:'hoje',data:undefined}),'');
 assert.equal(A.validAll({...a,tipo:'garante',qualificacao:'sim',materiais:'cliente'}),'');
 assert.match(A.validAll({...a,servico:'Pedreiro',detalhes:'instalacao',orcamento:'15000:30000'}),/opções/);
});

test('banco: faixa não vira preço exato; avaliação publica, preserva privacidade e retry',async()=>{
 const d=await db();try{
 const a=answers({orcamento_faixa:'avaliacao',orcamento_centavos:null,prazo:'normal'});
 const r=await pub(d,a);assert.match(r.descricao,/Orçamento estimado: Preciso de uma avaliação/);
 assert.equal(r.orcamento_aproximado_centavos,null);assert.equal(r.max_orcamentos,4);
 assert.equal((await pub(d,a)).id,r.id);
 await assert.rejects(pub(d,{...a,chave:uid(201),orcamento_faixa:'15000:30000'}),/pedido_duplicado_com_outros_dados/);
 await as(d,11);assert.equal(await scalar(d,`select public.qf_atendimento_respostas('${r.id}')`),null);
 assert.doesNotMatch(r.descricao,/Cliente Teste|11988887777/);
 await as(d,1);
 const g=await pub(d,answers({chave:uid(202),detalhes:'Pintar outra parede interna',orcamento_faixa:'50000:150000',orcamento_centavos:null,tipo:'garante',qualificacao:'sim'}));
 assert.match(g.descricao,/Orçamento estimado: R\$ 500,00 a R\$ 1500,00/);
 assert.equal(g.orcamento_aproximado_centavos,null);
 await as(d,11);assert.equal((await unlock(d,g.id,true)).preco_centavos,4000);
 }finally{await d.close();}
});

test('banco: rejeita faixas inválidas, preço inventado na avaliação e Garante não qualificado',async()=>{
 const d=await db();try{
 for(const orcamento_faixa of [null,'','0:0','30000:15000','0:50000001','telefone 11988887777'])await assert.rejects(pub(d,answers({orcamento_faixa,orcamento_centavos:null})),/faixa_invalida/);
 await assert.rejects(pub(d,answers({orcamento_faixa:'avaliacao'})),/avaliacao_sem_valor/);
 await assert.rejects(pub(d,answers({orcamento_faixa:'avaliacao',orcamento_centavos:null,tipo:'garante',qualificacao:'sim'})),/garante_nao_qualificado/);
 await assert.rejects(pub(d,answers({prazo:'hoje'})),/prazo_invalido/);
 await d.exec('reset role');assert.equal(await scalar(d,'select count(*) from private.test_dispatch'),0);
 }finally{await d.close();}
});
