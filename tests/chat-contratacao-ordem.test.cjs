const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('Plano Livre prioriza a conversa, oferece orçamento e mostra 13% previstos sem cobrança antecipada',async()=>{
 const dom=new JSDOM('<div data-qf-chat-root><div data-qf-chat-list>Histórico</div><form data-qf-chat-form><textarea></textarea><button>Enviar mensagem</button></form></div>',{
  url:'https://quemfazservico.com.br/#/profissional/chat/pedido-fixture',runScripts:'outside-only'
 });
 const w=dom.window;
 let data={ok:true,papel:'profissional',estado:'pendente',cliente_resposta:null,valor_centavos:null,proposta_em:null,etapas_separadas:true};
 const actions=[];
 w.Screens={};
 w.QFCloud={client:{rpc:async(name,args)=>{
  assert.equal(name,'qf_chat_contratacao');
  actions.push(args.p_acao);
  if(args.p_acao==='propor'){
   assert.equal(args.p_valor_centavos,35000);
   data={...data,estado:'negociando',proposta_em:new Date().toISOString(),valor_centavos:35000};
   return {data:{ok:true}};
  }
  return {data};
 }}};
 w.eval(fs.readFileSync(require('node:path').join(__dirname,'..','qf-chat-contratacao.js'),'utf8'));
 const root=w.document.querySelector('[data-qf-chat-root]');
 w.QFChatContratacao.mount(root,{id:'pedido-fixture'},{id:'pro-fixture'},'profissional');
 const wait=async fn=>{for(let i=0;i<60;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('Fluxo não renderizou');};
 try{
  await wait(()=>root.querySelector('[data-qfc-form]'));
  const chat=root.querySelector('[data-qf-chat-form]');
  const panel=root.querySelector('.qf-chat-contract');
  assert.ok(chat.compareDocumentPosition(panel)&w.Node.DOCUMENT_POSITION_FOLLOWING,'A mensagem deve aparecer antes do orçamento');
  assert.ok(root.querySelector('[data-qf-chat-list]').compareDocumentPosition(chat)&w.Node.DOCUMENT_POSITION_FOLLOWING,'Mensagens antes da caixa de digitar');
  assert.ok(panel.querySelector('details.qfc-support'),'Suporte deve estar recolhido em seção separada');
  assert.equal(panel.querySelector('details.qfc-support').open,false);
  assert.ok(panel.querySelector('[data-qfc-form]').compareDocumentPosition(panel.querySelector('details.qfc-support'))&w.Node.DOCUMENT_POSITION_FOLLOWING,'O orçamento deve aparecer antes do suporte');
  const form=panel.querySelector('[data-qfc-form]');form.querySelector('[data-qfc-valor]').value='350,00';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  await wait(()=>panel.textContent.includes('Atualizar orçamento do cliente'));
  assert.ok(actions.includes('propor'));
  assert.match(panel.textContent,/13%/);
  assert.match(panel.textContent,/87%/);
  assert.match(panel.textContent,/45,50/);
  assert.match(panel.textContent,/304,50/);
  assert.doesNotMatch(panel.textContent,/Comissão de 13% foi gerada automaticamente/);
 } finally {dom.window.close();}
});
