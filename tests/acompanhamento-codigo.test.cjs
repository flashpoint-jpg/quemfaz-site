const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,rpc,answers}=require('./helpers/comissao13-owner.cjs');const {uid,as}=require('./helpers/atendimento-db.cjs');
test('Pedido real: segredo na publicação, código exclusivo no acompanhamento, sem cadastro/SMS e sem acesso de profissional',async()=>{
 const d=await fixture();try{await as(d,1);const a=answers(),call=await rpc(d,'qf_publicar_atendimento',[a,{latitude:-23.66,longitude:-46.53}]);assert.ok(call.id);assert.ok(!JSON.stringify(call).includes(a.segredo_acompanhamento));assert.equal((await rpc(d,'qf_publicar_atendimento',[a,{latitude:-23.66,longitude:-46.53}])).id,call.id);
 await d.exec('reset role');assert.equal((await d.query('select respostas ? $1 as leaked from private.qf_atendimentos where chamado_id=$2',['segredo_acompanhamento',call.id])).rows[0].leaked,false);
 await as(d,0);let view=await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento]);assert.match(view.codigo,/^\d{6}$/);const code=view.codigo;
 assert.equal((await rpc(d,'qf13_acompanhar',[call.id,'b'.repeat(64)])).ok,false);
 await as(d,11);assert.equal((await rpc(d,'qf13_codigo_cliente',[call.id])).ok,false);assert.equal((await rpc(d,'qf_comissao13_desbloquear',[call.id,true])).ok,true);let f=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];assert.ok(!JSON.stringify(f).includes(code));
 assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',50000,code==='000000'?'111111':'000000'])).ok,false);
 assert.equal((await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',50000,code])).ok,true);assert.equal((await rpc(d,'qf_comissao13_fechamentos_painel'))[0].comissao_centavos,null);
 await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento])).codigo,code,'código recuperável sem sessão');
 await as(d,12);await rpc(d,'qf_comissao13_desbloquear',[call.id,true]);f=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];await rpc(d,'qf_comissao13_prestar_contas',[f.id,'recusado']);await as(d,0);
 assert.equal((await rpc(d,'qf13_acompanhar',[call.id,'b'.repeat(64),'responder',f.id,true])).ok,false);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true])).resposta,'divergencia');assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,false])).ok,false,'resposta não sobrescrita');
 await as(d,12);assert.equal((await rpc(d,'qf_comissao13_status')).bloqueio,null);await d.exec('reset role');await d.exec("select set_config('test.admin','true',false)");await as(d,1);const h=await rpc(d,'qf13_admin_historico',[f.id]);assert.ok(h.eventos.some(x=>x.depois.cliente_resposta==='divergencia'));
 console.log('PASS código: publicação real, segredo não exposto, acompanhamento anônimo protegido, código certo/errado, prestação na API real, divergência sem cobrança e auditoria.');
 }finally{await d.close();}
});


test('Publicação real encaminha ao acompanhamento sem mostrar código de contratação',async()=>{
 const {JSDOM}=require('jsdom');const d=await fixture();let clientDom,proDom,adminDom;
 const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('A tela não alcançou o estado esperado');};
 try{
  clientDom=new JSDOM('<main id="app-content"></main>',{url:'https://quemfazservico.com.br/',runScripts:'outside-only'});const w=clientDom.window;w.QFApp={isNativeApp:()=>true};
  w.QFCloud={enabled:true,signUp:async()=>({ok:true,user:{id:uid(1),role:'cliente',nome:'Cliente Teste',telefone:'11988887777'}}),createCall:async data=>{await as(d,1);return rpc(d,'qf_publicar_atendimento',[data.atendimento,{latitude:-23.66,longitude:-46.53}]);},client:{rpc:async()=>({data:{ok:true}})}};
  w.DB={state:{categories:[{id:'pintor',nome:'Pintor'}]},categoryById:()=>({id:'pintor',nome:'Pintor'}),categories:()=>[{id:'pintor',nome:'Pintor'}],persist(){}};
  let callId;w.fetch=async(url,o)=>{assert.ok(url.endsWith('/qf13_acompanhar'));const b=JSON.parse(o.body);callId=b.p_chamado_id;await as(d,0);return {ok:true,json:()=>rpc(d,'qf13_acompanhar',[b.p_chamado_id,b.p_segredo,b.p_acao||'ver',b.p_fechamento||null,b.p_contratou??null])};};
  let navigated='';w.__qfNavigate=u=>{navigated=u;};w.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));w.eval(fs.readFileSync('qf-atendimento.js','utf8'));const content=w.document.getElementById('app-content');content.innerHTML=w.QFAtendimento.html();w.QFAtendimento.mount(content,{catId:'pintor'},null);
  const values={cidade:'Santo André',bairro:'Centro',nome:'Cliente Teste',contato:'11988887777'};
  for(let i=0;i<25&&!navigated;i++){
   const form=content.querySelector('form');if(!form)break;const checkbox=form.querySelector('input[type=checkbox]');if(checkbox)checkbox.checked=true;const radio=form.querySelector('input[type=radio]');if(radio){const chosen=form.querySelector('[value=contratar],[value=sim]')||radio;chosen.checked=true;}const select=form.querySelector('select');if(select)select.value='SP';for(const el of form.querySelectorAll('input:not([type=radio]):not([type=checkbox]),textarea')){const field=el.id.replace('at-','');el.value=values[field]||el.value||'Pintar uma parede';}
   form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));if(form.querySelector('[data-at-publish]'))break;
  }
  await wait(()=>navigated);callId=navigated.split('#pedido=')[1];assert.match(navigated,/^\/acompanhar-pedido\.html\?publicado=1#pedido=[a-f0-9-]{36}$/);assert.ok(!/comiss|administra|cobran|13%/i.test(content.textContent),'tela do cliente sem comissão/administração/cobrança');const secret=w.localStorage.getItem('qf_pedido_owner_'+callId);assert.match(secret,/^[a-f0-9]{64}$/);
  const ownerBox=w.document.createElement('section');content.replaceChildren(ownerBox);await w.QFAcompanhamento.mount(ownerBox,callId);assert.equal(ownerBox.querySelector('[data-qf-owner-code]'),null);assert.equal(ownerBox.querySelector('[data-qf-owner-copy]'),null);assert.ok(!/comiss|administra|cobran|13%/i.test(ownerBox.textContent));
  const success=w.document.createElement('section');content.replaceChildren(success);await w.QFAcompanhamento.mount(success,callId,{publicado:true});assert.match(success.textContent,/Pedido publicado!/);assert.equal(success.querySelector('[data-qf-owner-code]'),null);assert.equal(success.querySelector('a').getAttribute('href'),'/?app=1#/cliente/pedidos');
  const alien=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br/',runScripts:'outside-only'});alien.window.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));await alien.window.QFAcompanhamento.mount(alien.window.document.querySelector('main'),callId);assert.match(alien.window.document.body.textContent,/navegador ou aparelho/);assert.equal(alien.window.document.querySelector('[data-qf-owner-answer]'),null);alien.window.close();
 }finally{clientDom?.window.close();proDom?.window.close();adminDom?.window.close();await d.close();}
});

test('Código antigo salvo não reaparece nem concede poder de confirmação',async()=>{
 const {JSDOM}=require('jsdom');const dom=new JSDOM('<main></main>',{url:'https://quemfazservico.com.br',runScripts:'outside-only'});const w=dom.window;w.sessionStorage.setItem('qf_cliente_codigo_pedido',JSON.stringify({pedidoId:uid(900),codigo:'123456',clienteId:uid(1)}));w.eval(fs.readFileSync('qf-acompanhamento.js','utf8'));await w.QFAcompanhamento.mount(w.document.querySelector('main'),uid(900));assert.equal(w.document.querySelector('[data-qf-owner-code]'),null);assert.match(w.document.body.textContent,/navegador ou aparelho/);assert.equal(w.document.querySelectorAll('[data-qf-owner-answer]').length,0);dom.window.close();
});
