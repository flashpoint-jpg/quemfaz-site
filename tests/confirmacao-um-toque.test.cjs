const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,rpc,answers}=require('./helpers/comissao13-owner.cjs');
const {as,uid}=require('./helpers/atendimento-db.cjs');
const ui=require('../qf-comissao13.js');
async function setup(){const d=await fixture();await d.exec('reset role');await d.exec("create function private.qf_livre_identificacao(uuid) returns boolean language sql as $$select false$$;");await d.exec(fs.readFileSync('docs/qf13-confirmacao-um-toque.sql','utf8'));await as(d,1);const a=answers(),call=await rpc(d,'qf_publicar_atendimento',[a,{latitude:-23.66,longitude:-46.53}]);await as(d,11);assert.equal((await rpc(d,'qf_comissao13_desbloquear',[call.id,true])).ok,true);const f=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];return {d,a,call,f};}
test('Cliente responde sem prestação do profissional; correção auditada, isolamento e nenhuma cobrança automática',async()=>{
 const {d,a,call,f}=await setup();try{
  await as(d,0);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,'b'.repeat(64),'responder',f.id,true])).ok,false);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',uid(999),true])).ok,false);
  assert.equal((await rpc(d,'qf13_acompanhar',[uid(100),a.segredo_acompanhamento,'responder',f.id,true])).ok,false);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true])).resposta,'confirmado');
  let view=await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento]);assert.equal(view.profissionais[0].status,'pendente');assert.equal(view.profissionais[0].cliente_resposta,'confirmado');
  assert.equal(ui.etapa({...f,cliente_resposta:'confirmado'}),'concluir');
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,false])).resposta,'nao_contratou');
  await as(d,11);assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',50000,null])).ok,true);
  let row=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];assert.equal(row.codigo_validado_em,null);assert.equal(row.comissao_centavos,null);assert.equal(row.cobranca_status,'nao_gerada');assert.equal(ui.etapa(row),'revisar');
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true])).resposta,'confirmado');
  await as(d,12);assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',90000])).ok,false,'outro profissional não presta contas');
  await d.exec('reset role');assert.equal((await d.query("select count(*)::integer n from private.qf_comissao13_notificacoes where chave like $1",['fechamento13:'+f.id+':%'])).rows[0].n,2,'pergunta no desbloqueio e no fechamento');
  assert.ok((await d.query('select count(*)::integer n from private.qf13_auditoria where fechamento_id=$1',[f.id])).rows[0].n>=5);
  await d.exec("select set_config('test.admin','true',false)");await as(d,1);
  assert.equal((await rpc(d,'qf_comissao13_admin',[f.id,'confirmar',50000,'Cliente confirmou em seu acompanhamento protegido; valor conferido.'])).ok,true);
  row=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];assert.equal(row.comissao_centavos,6500);assert.equal(row.cobranca_status,'pendente');
 }finally{await d.close();}
});
test('Negativa falsa, código alternativo, dados inválidos e prazos continuam protegidos',async()=>{
 const {d,a,call,f}=await setup();try{
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'negociando'])).ok,true);
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'negociando'])).reason,'limite_prorrogacao');
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',-1])).ok,false);
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',50000,'bad'])).ok,false);
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'recusado'])).ok,true);
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true])).resposta,'divergencia');
  await as(d,11);let row=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];assert.equal(ui.etapa(row),'revisar');assert.equal(row.comissao_centavos,null);
  await as(d,12);assert.equal((await rpc(d,'qf_comissao13_desbloquear',[call.id,true])).ok,true);const second=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];await as(d,0);const code=(await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento])).codigo;
  await as(d,12);assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[second.id,'informado',50000,code])).codigo_validado,true);
  await as(d,13);assert.equal((await rpc(d,'qf_comissao13_desbloquear',[call.id,true])).ok,true);row=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];await d.exec('reset role');await d.query("update public.qf_comissao13_fechamentos set prazo_contas=now()-interval '1 hour' where id=$1",[row.id]);await as(d,13);assert.equal((await rpc(d,'qf_comissao13_status')).bloqueio,'prestacao_contas_vencida');
 }finally{await d.close();}
});
test('Tela real exige conclusão, valor e código; contratação isolada não aprova comissão',async()=>{
 const {JSDOM}=require('jsdom'),{d,a,call}=await setup();
 const dom=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br',runScripts:'outside-only'}),w=dom.window;
 try{
  await as(d,11);const f=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',50000,null]);
  w.localStorage.setItem('qf_pedido_owner_'+call.id,a.segredo_acompanhamento);let writes=0;
  w.fetch=async(url,o)=>{const b=JSON.parse(o.body);if(b.p_acao&&b.p_acao!=='ver')writes++;await as(d,0);return {ok:true,json:()=>rpc(d,'qf13_acompanhar',[b.p_chamado_id,b.p_segredo,b.p_acao||'ver',b.p_fechamento||null,b.p_contratou??null])};};
  w.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));await w.QFAcompanhamento.mount(w.document.querySelector('main'),call.id);
  assert.equal(w.document.querySelector('[data-qf-owner-code]'),null);
  assert.equal(w.document.querySelector('[data-qf-owner-answer=sim]'),null);
  const form=w.document.querySelector('[data-qf-owner-concluir]');assert.ok(form);
  for(const name of ['codigo_seguranca','valor_final','concluido'])assert.equal(form.elements[name].required,true);
  assert.equal(writes,0);
  await as(d,11);const row=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];assert.equal(row.comissao_centavos,null);
 }finally{w.close();await d.close();}
});
