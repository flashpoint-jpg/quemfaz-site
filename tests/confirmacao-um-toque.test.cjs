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
test('Tela real: um clique salva a resposta antes do profissional; formulário profissional aceita sem código; painel exibe resposta',async()=>{
 const {JSDOM}=require('jsdom'),{d,a,call,f}=await setup();let owner,pro;const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout');};
 try{
  owner=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br',runScripts:'outside-only'});const w=owner.window;w.localStorage.setItem('qf_pedido_owner_'+call.id,a.segredo_acompanhamento);let writes=0;
  w.fetch=async(url,o)=>{const b=JSON.parse(o.body);if(b.p_acao==='responder')writes++;await as(d,0);return {ok:true,json:()=>rpc(d,'qf13_acompanhar',[b.p_chamado_id,b.p_segredo,b.p_acao||'ver',b.p_fechamento||null,b.p_contratou??null])};};
  w.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));await w.QFAcompanhamento.mount(w.document.querySelector('main'),call.id);assert.ok(w.document.querySelector('[data-qf-owner-code]'));assert.equal(w.document.querySelector('[data-qf-owner-code]').closest('details'),null);
  w.document.querySelector('[data-qf-owner-answer=sim]').click();await wait(()=>w.document.body.textContent.includes('Resposta salva.'));assert.equal(writes,1);assert.match(w.document.body.textContent,/Sua resposta: contratei/);assert.equal(w.document.querySelector('[data-qf-owner-answer=sim]').getAttribute('aria-pressed'),'true');
  pro=new JSDOM('<main id="app-content"><div class="view"></div></main>',{url:'https://quemfazservico.com.br/#/profissional/pedido/'+call.id,runScripts:'outside-only'});const p=pro.window;Object.defineProperty(p.document,'readyState',{value:'complete'});p.Screens={};p.DB={requestById:()=>({atendimentoTipo:'tradicional',modalidade:'contatos'})};p.QFCloud={client:{rpc:async(n,args={})=>{await as(d,11);return {data:await rpc(d,n,Object.values(args))};}}};
  p.eval(fs.readFileSync('qf-comissao13.js','utf8'));await wait(()=>p.document.querySelector('[data-qf13-abrir]'));assert.equal(p.document.querySelector('[data-qf13-cliente-confirmou]').hidden,false);assert.match(p.document.querySelector('[data-qf13-cliente-confirmou]').textContent,/Contratação confirmada pelo cliente/);p.document.querySelector('[data-qf13-abrir]').click();const form=p.document.querySelector('[data-qf13-inline-form]');assert.equal(form.elements.codigo.required,false);form.elements.valor.value='500,00';form.dispatchEvent(new p.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>p.document.body.textContent.includes('Fechamento informado.'));
  await as(d,11);const row=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];assert.equal(row.codigo_validado_em,null);assert.equal(row.cliente_resposta,'confirmado');assert.match(ui.painel([row],true),/Sim, contratei/);assert.equal(row.comissao_centavos,null);
 }finally{owner?.window.close();pro?.window.close();await d.close();}
});
