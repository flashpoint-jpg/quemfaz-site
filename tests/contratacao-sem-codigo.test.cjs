const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,rpc,answers}=require('./helpers/comissao13-owner.cjs');
const {as,uid}=require('./helpers/atendimento-db.cjs');
const {setup}=require('./helpers/contratacao-sem-codigo.cjs');
async function row(d,f){await d.exec('reset role');return (await d.query('select * from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0];}
test('Sem código: valor confirmado gera 13%, Pix único e prazo de 48h; sem resposta não cobra',async()=>{
 const {d,a,call,f}=await setup();try{
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',35000])).ok,true);
  assert.equal((await row(d,f)).comissao_centavos,null);
  await as(d,0);let view=await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento]);assert.equal('codigo' in view,false);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true])).reason,'valor_alterado');
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true,35000])).ok,true);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true,35000])).ok,true);
  const f1=await row(d,f);assert.equal(Number(f1.comissao_centavos),4550);assert.equal(f1.codigo_validado_em,null);
  assert.equal(new Date(f1.comissao_vence_em)-new Date(f1.confirmado_em),48*3600000);
  assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,1);
  assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,null);
  await d.query("update qf_comissao13_fechamentos set comissao_vence_em=now()-interval '1 minute' where id=$1",[f.id]);
  assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,'comissao_pendente');
  await d.query("update qf_comissao13_fechamentos set cobranca_status='paga' where id=$1",[f.id]);
  assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,null);
 }finally{await d.close();}
});
test('Chat: autorização, valor desatualizado, correção, um contratado e Pix idempotente',async()=>{
 const {d,a,call,f}=await setup();try{
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000])).ok,true);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000])).reason,'sem_permissao');
  await as(d,12);assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',90000])).ok,false);
  await as(d,1);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'corrigir_valor'])).ok,true);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000])).ok,false);
  await as(d,11);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',40000])).ok,true);
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,'b'.repeat(64),'responder',f.id,true,40000])).ok,false);
  await as(d,1);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000])).reason,'valor_alterado');
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',40000])).ok,true);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',40000])).ok,true);
  assert.equal(Number((await row(d,f)).comissao_centavos),5200);
  await as(d,12);assert.equal((await rpc(d,'qf_comissao13_desbloquear',[call.id,true])).ok,true);
  const f2=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];
  assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f2.id,'informado',10000])).ok,true);
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f2.id,true,10000])).reason,'outro_profissional_contratado');
  await d.exec('reset role');assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,1);
 }finally{await d.close();}
});
test('Interface atual: cliente confirma conclusão, valor e código protegido',async()=>{
 const {JSDOM}=require('jsdom'),{d,a,call,f}=await setup({seguranca:true});let dom;
 try{
  await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',35000]);
  dom=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br',runScripts:'outside-only'});const w=dom.window;
  w.localStorage.setItem('qf_pedido_owner_'+call.id,a.segredo_acompanhamento);let writes=0,ownerCode;
  w.fetch=async(url,o)=>{const b=JSON.parse(o.body);if(b.p_acao==='responder'){writes++;assert.equal(b.p_valor_centavos,35000);}await as(d,0);return {ok:true,json:async()=>{const data=await rpc(d,'qf13_acompanhar',[b.p_chamado_id,b.p_segredo,b.p_acao||'ver',b.p_fechamento||null,b.p_contratou??null,b.p_valor_centavos??null,b.p_codigo??null,b.p_concluido??false]);if(data.codigo_seguranca)ownerCode=data.codigo_seguranca;return data;}};};
  w.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));await w.QFAcompanhamento.mount(w.document.querySelector('main'),call.id);
  assert.equal(w.document.querySelector('[data-qf-owner-code]'),null);assert.match(w.document.body.textContent,/350,00/);
  const form=w.document.querySelector('[data-qf-owner-concluir]');form.elements.codigo_seguranca.value=ownerCode;form.elements.concluido.checked=true;form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  for(let i=0;i<150&&!w.document.body.textContent.includes('Contratação, valor e conclusão confirmados.');i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(writes,1);assert.match(w.document.body.textContent,/Contratação, valor e conclusão confirmados/);
  assert.equal(Number((await row(d,f)).comissao_centavos),4550);
 }finally{dom?.window.close();await d.close();}
});
test('Tela profissional envia valor; cliente confirma código e conclusão no chat',async()=>{
 const {JSDOM}=require('jsdom'),{d,call,f}=await setup({seguranca:true});let pro,owner;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Tela não atualizou');};
 try{
  pro=new JSDOM('<main id="app-content"><div class="view"></div></main>',{url:'https://quemfazservico.com.br/#/profissional/pedido/'+call.id,runScripts:'outside-only'});
  const p=pro.window;Object.defineProperty(p.document,'readyState',{value:'complete'});p.Screens={};p.DB={requestById:()=>({atendimentoTipo:'tradicional',modalidade:'contatos'})};
  p.QFCloud={client:{rpc:async(n,args={})=>{await as(d,11);return {data:await rpc(d,n,Object.values(args))};}}};
  p.eval(fs.readFileSync('qf-comissao13.js','utf8'));await wait(()=>p.document.querySelector('[data-qf13-abrir]'));
  p.document.querySelector('[data-qf13-abrir]').click();const form=p.document.querySelector('[data-qf13-inline-form]');assert.equal(form.elements.codigo,undefined);
  form.elements.valor.value='350,00';form.dispatchEvent(new p.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>p.document.body.textContent.includes('Fechamento informado.'));
  owner=new JSDOM('<main data-qf-chat-root></main>',{url:'https://quemfazservico.com.br',runScripts:'outside-only'});const w=owner.window;let accepts=0;
  w.confirm=()=>{throw Error('Não deve pedir segunda confirmação');};w.Screens={};
  w.QFCloud={client:{rpc:async(n,args)=>{await as(d,1);if(args.p_acao==='aceitar'){accepts++;assert.equal(args.p_valor_centavos,35000);}return {data:await rpc(d,n,Object.values(args))};}}};
  w.eval(fs.readFileSync('qf-chat-contratacao.js','utf8'));w.QFChatContratacao.mount(w.document.querySelector('main'),{id:call.id,profId:uid(11)},{id:uid(1)},'cliente');
  await wait(()=>w.document.querySelector('[data-qfc-concluir]'));await as(d,1);const code=(await rpc(d,'qf_chat_contratacao',[call.id,uid(11)])).codigo_seguranca;const finish=w.document.querySelector('[data-qfc-concluir]');finish.elements.codigo_seguranca.value=code;finish.elements.concluido.checked=true;finish.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.document.body.textContent.includes('Contratação, valor e conclusão confirmados.'));
  assert.equal(accepts,1);assert.equal(Number((await row(d,f)).comissao_centavos),4550);
 }finally{pro?.window.close();owner?.window.close();await d.close();}
});
