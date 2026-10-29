const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('A tela não atualizou');};
function load(w,file){w.eval(fs.readFileSync(file,'utf8'));}
function dialogSupport(w){w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};}
const find=(w,label)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===label);
test('negociação: editar orçamento, excluir da lista e restaurar com confirmação do servidor',async()=>{
 const dom=new JSDOM('<main id="app-content"></main>',{url:'https://example.test/admin.html#/admin/negociacoes',runScripts:'outside-only'}),w=dom.window;dialogSupport(w);
 const row={desbloqueio_id:'desb1',chamado_id:'pedido1',profissional:'Profissional',cliente:'Cliente',origem:'comissao13',fechamento_id:'f1',valor_informado_centavos:10000};let controls=[];let updates=0;
 w.Screens={};w.QFAdminCloud={client:{rpc:async(name,a={})=>{
  if(name==='qf_admin_negociacoes')return {data:[row]};
  if(name==='qf_admin_lista_controle'){
   if(!a.p_dados)return {data:controls};updates++;const c={...controls[0],chave:a.p_chave,...a.p_dados};controls=[c];if(a.p_dados.valor_centavos)row.valor_informado_centavos=a.p_dados.valor_centavos;
   return {data:{ok:true,registro:c}};
  }
  return {error:{message:'RPC inesperada: '+name}};
 }}};
 try{
  load(w,'qf-admin-organizacao.js');load(w,'qf-admin-negociacoes.js');w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await wait(()=>find(w,'Editar'));find(w,'Editar').click();
  let f=w.document.querySelector('.qfo-dialog form');f.elements.valor.value='150.00';f.elements.observacao.value='Revisado';f.dispatchEvent(new w.Event('submit',{cancelable:true}));
  await wait(()=>!w.document.querySelector('.qfo-dialog'));assert.equal(row.valor_informado_centavos,15000);assert.equal(controls[0].observacao,'Revisado');
  find(w,'Excluir da lista').click();assert.equal(updates,1,'abrir a confirmação não exclui');w.document.querySelector('[data-confirm]').click();
  await wait(()=>!w.document.querySelector('[data-qfn-open]'));assert.equal(controls[0].excluido,true);
  find(w,'Ver excluídas').click();assert.ok(w.document.querySelector('[data-qfn-open]'));find(w,'Restaurar').click();w.document.querySelector('[data-confirm]').click();
  await wait(()=>!w.document.querySelector('[data-qfn-open]'));find(w,'Mostrar negociações ativas').click();assert.ok(w.document.querySelector('[data-qfn-open]'));assert.equal(controls[0].excluido,false);
 }finally{w.close();}
});
test('cadastro: excluir da lista não remove a conta nem executa cobrança',async()=>{
 const dom=new JSDOM('<body class="qf-adm-body"><main id="app-content"></main></body>',{url:'https://example.test/admin.html#/admin/planos',runScripts:'outside-only'}),w=dom.window;dialogSupport(w);
 const row={email:'teste@local.test',nome:'Cadastro Teste',profissional_id:'pro1',situacao:'teste',servidor_agora:new Date().toISOString()};let controls=[];const calls=[];
 w.Screens={};w.DB={getSession:()=>({role:'admin'})};w.QFAdminCloud={enabled:true,client:{rpc:async(name,a={})=>{
  calls.push(name);
  if(name==='qf_admin_cadastro_pagamentos')return {data:{}};
  if(name==='qf_admin_livre_painel')return {data:{itens:[row],total:1}};
  if(name==='qf_admin_lista_controle'){if(a.p_dados){controls=[{chave:a.p_chave,...a.p_dados}];return {data:{ok:true}};}return {data:controls};}
  return {error:{message:'Ação inesperada'}};
 }}};
 try{
  load(w,'qf-admin-organizacao.js');load(w,'qf-admin-cadastro-pago.js');w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await wait(()=>find(w,'Excluir da lista'));find(w,'Excluir da lista').click();w.document.querySelector('[data-confirm]').click();
  await wait(()=>!w.document.querySelector('.qf-pre-record'));find(w,'Ver excluídos').click();assert.ok(w.document.querySelector('.qf-pre-record'));assert.ok(find(w,'Restaurar'));
  assert.ok(!calls.some(x=>/excluir_usuario|remover_plano|ativar_plano/.test(x)));
 }finally{w.close();}
});

