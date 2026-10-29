const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom'),{ready}=require('./helpers/negociacoes-admin.cjs'),{rpc}=require('./helpers/comissao13-owner.cjs'),{as,uid}=require('./helpers/atendimento-db.cjs');
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('UI não atualizou');};
test('UI do cliente: três escolhas, negociar, contratar sem cobrança, conclusão e valor final com código',async()=>{
 const {d,call}=await ready();const dom=new JSDOM('<main><div data-qf-chat-root><div data-qf-chat-list></div></div></main>',{url:'https://quemfazservico.com.br/?app=1',runScripts:'outside-only'}),w=dom.window;
 try{await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);await as(d,1);
  w.QFCloud={client:{rpc:async(name,a)=>{try{return {data:await rpc(d,name,[a.p_chamado_id,a.p_profissional_id,a.p_acao,a.p_valor_centavos,a.p_codigo,a.p_concluido])};}catch(error){return {error};}}}};
  w.eval(fs.readFileSync('qf-chat-contratacao.js','utf8'));w.QFChatContratacao.mount(w.document.querySelector('main'),{id:call.id,profId:uid(11)},{id:uid(1)},'cliente');
  await wait(()=>w.document.querySelector('[data-qfc-action="contratar"]'));
  assert.ok(w.document.body.textContent.includes('Aceitei o orçamento'));assert.ok(w.document.body.textContent.includes('Ainda estou negociando'));assert.ok(w.document.body.textContent.includes('Não contratei'));assert.equal(w.document.querySelector('[data-qfc-concluir]'),null);
  w.document.querySelector('[data-qfc-action="negociando"]').click();await wait(()=>w.document.body.textContent.includes('Cliente ainda')||w.document.querySelector('[data-qfc-action="contratar"]')?.disabled===false);
  w.document.querySelector('[data-qfc-action="contratar"]').click();await wait(()=>w.document.querySelector('[data-qfc-concluir]'));
  await d.exec('reset role');assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,0);await as(d,1);
  const v=await rpc(d,'qf_chat_contratacao',[call.id,uid(11)]),f=w.document.querySelector('[data-qfc-concluir]');f.elements.codigo_seguranca.value=v.codigo_seguranca;f.elements.valor_final.value='400,00';f.elements.concluido.checked=true;f.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>w.document.body.textContent.includes('Contratação, valor e conclusão confirmados.'));
  await d.exec('reset role');assert.equal(Number((await d.query('select comissao_centavos from qf_comissao13_fechamentos')).rows[0].comissao_centavos),5200);
 }finally{w.close();await d.close();}
});
test('UI administrativa: orçamento real da API, busca, detalhe, leitura sem enviar mensagem e sem dados de terceiros',async()=>{
 const {d,call}=await ready(),dom=new JSDOM('<main id="app-content"></main>',{url:'https://quemfazservico.com.br/admin.html#/admin/negociacoes',runScripts:'outside-only'}),w=dom.window;
 try{await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);await d.exec("reset role;select set_config('test.admin','true',false)");await as(d,1);w.Screens={};let writes=0;
  w.QFAdminCloud={client:{rpc:async(n,a)=>{try{if(n==='qf_admin_lista_controle'&&!a.p_dados)return {data:[]};if(!['qf_admin_negociacoes','qf_admin_negociacao_detalhe'].includes(n)){writes++;throw Error('Mutação inesperada');}return {data:await rpc(d,n,n==='qf_admin_negociacao_detalhe'?[a.p_desbloqueio]:[])};}catch(error){return {error};}}}};
  w.eval(fs.readFileSync('qf-admin-negociacoes.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await wait(()=>w.document.querySelector('[data-qfn-open]' ));
  assert.match(w.document.body.textContent,/350,00/);assert.match(w.document.body.textContent,/Comissão: Sem cobrança/);assert.doesNotMatch(w.document.body.textContent,/45,50/);
  w.document.querySelector('[data-qfn-open]').click();await wait(()=>w.document.querySelector('[data-qfn-reminder] a'));
  assert.ok(w.document.body.textContent.includes('Conversa interna'));assert.ok(w.document.querySelector('[data-qfn-reminder] a').href.startsWith('https://wa.me/5511988887777?text='));assert.ok(w.document.body.textContent.includes('Abrir não comprova envio'));
  const dialog=w.document.querySelector('dialog');assert.ok(dialog.hasAttribute('open'));
  assert.ok(dialog.querySelector('.qfn-detail-grid'));assert.ok(dialog.querySelector('.qfn-messages'));
  assert.ok([...dialog.querySelectorAll('details')].every(x=>!x.open),'históricos recolhidos inicialmente');
  assert.equal(dialog.querySelectorAll('pre').length,0,'não despeja JSON na tela');
  dialog.querySelector('[data-qfn-close]').click();assert.equal(w.document.querySelector('dialog'),null);
  assert.equal(writes,0);
  await d.exec('reset role');assert.equal((await d.query('select count(*)::int n from qf_chat_mensagens where lida_em is not null')).rows[0].n,0);
 }finally{w.close();await d.close();}
});

