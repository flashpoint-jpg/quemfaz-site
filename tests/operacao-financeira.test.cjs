const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {totals,bankIn,bankOut}=require('../qf-admin-financeiro.js');
test('previsão, entrada bancária, comissão e repasse não se confundem nem duplicam negociação',()=>{
 const data={pagamentos:[{status:'repassado',valor_centavos:10000,profissional_centavos:8700},
  {status:'pago',end_to_end_id:'E123',confirmado_em:'2026-10-28',valor_centavos:20000,profissional_centavos:17400},
  {status:'repassado',end_to_end_id:'E456',confirmado_em:'2026-10-28',repassado_em:'2026-10-28',valor_centavos:30000,profissional_centavos:26100}]};
 const n={origem:'comissao13',status:'confirmado',fechamento_id:'a',cobranca_status:'paga',pagamento_conciliado:true,comissao_centavos:1300};
 assert.deepEqual(totals(data,[n,n,{...n,fechamento_id:'b',pagamento_conciliado:false},{...n,fechamento_id:'c',cobranca_status:'pendente',comissao_centavos:3900}]),{receber:3900,recebida:1300,entrada:50000,repasse:26100});
 assert.equal(bankIn(data.pagamentos[0]),false);assert.equal(bankOut(data.pagamentos[1]),false);assert.equal(bankOut(data.pagamentos[2]),true);
});
for(const situation of ['ativo','vencido','inativo','falha_consulta'])test('Carteira salva e altera Pix com plano '+situation,async()=>{
 const dom=new JSDOM('<div id="app-content"><div class="view"></div></div>',{url:'https://quemfazservico.com.br/#/profissional/carteira',runScripts:'outside-only'});
 const w=dom.window;let saved=null,calls=[];
 const builder={select(){return this;},eq(k,v){assert.equal(k,'profissional_id');assert.equal(v,'pro-existente');return this;},maybeSingle:async()=>({data:saved,error:null}),upsert:async(row,opts)=>{assert.equal(row.profissional_id,'pro-existente');assert.equal(opts.onConflict,'profissional_id');saved=row;calls.push(row);return {error:null};}};
 w.Screens={};w.QFCloud={client:{auth:{getUser:async()=>({data:{user:{id:'pro-existente'}}})},from:n=>{assert.equal(n,'qf_livre_pix_chaves');return builder;},rpc:async()=>situation==='falha_consulta'?{error:{message:'offline'}}:{data:{ok:true,ativo:situation==='ativo'},error:null}}};
 w.eval(fs.readFileSync('qf-livre.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,20));
 const form=w.document.querySelector('[data-qf-pix-form]');assert.ok(form);assert.equal(w.document.querySelectorAll('[data-qf-pix-form]').length,1);
 assert.equal(form.querySelector('[name=contaEfi]'),null);
 for(const key of ['primeiro@example.com','segundo@example.com']){form.elements.chavePix.value=key;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setTimeout(r,10));assert.equal(saved.chave_pix,key);}
 assert.equal(calls.length,2);assert.match(w.document.querySelector('[data-qf-pix-status]').textContent,/Chave Pix salva/);dom.window.close();
});
