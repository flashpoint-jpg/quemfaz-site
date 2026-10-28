const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../qf-acompanhamento.js'),'utf8');
const migration=fs.readFileSync(require.resolve('../supabase/migrations/20261028032700_qf13_cliente_relato_e_conciliacao.sql'),'utf8');
const reviewFix=fs.readFileSync(require.resolve('../supabase/migrations/20261028033000_qf13_relato_cliente_confirmado_sem_cobranca.sql'),'utf8');
const uid='00000000-0000-4000-8000-000000000101';
const fid='00000000-0000-4000-8000-000000000102';
function setup(){
 const dom=new JSDOM('<main><section id="tracking"></section></main>',{url:'https://quemfazservico.com.br/',runScripts:'outside-only'});
 const w=dom.window;const secret='a'.repeat(64);w.localStorage.setItem('qf_pedido_owner_'+uid,secret);
 let seen=[],already=false;
 w.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);seen.push({url,body});
  if(url.endsWith('/qf13_cliente_informar_fechamento')){
   already=true;return {ok:true,json:async()=>({ok:true,status:'contestado',revisao_admin:true,comissao_devida:false})};
  }
  return {ok:true,json:async()=>({ok:true,pedido:{titulo:'Reparo de portão',cidade:'Santo André',bairro:'Centro',status:'em_negociacao'},profissionais:[{id:fid,profissional:'Profissional A',status:already?'contestado':'pendente',contratado_em:already?'2026-10-28T00:00:00Z':null,cliente_resposta:already?'divergencia':null,valor_aceito_centavos:already?50000:null,valor_centavos:null}]})};
 };
 w.eval(source);return {dom,w,seen,secret};
}
test('cliente pode declarar contratação quando profissional não informou fechamento',async()=>{
 const t=setup();try{
  const root=t.w.document.querySelector('#tracking');
  await t.w.QFAcompanhamento.mount(root,uid,{embedded:true});
  const form=root.querySelector('[data-qf-owner-relato]');
  assert.ok(form,'mostra opção independente');
  form.elements.valor.value='500,00';form.elements.confirma.checked=true;
  form.dispatchEvent(new t.w.Event('submit',{bubbles:true,cancelable:true}));
  await new Promise(r=>setTimeout(r,50));
  const call=t.seen.find(x=>x.url.endsWith('/qf13_cliente_informar_fechamento'));
  assert.ok(call,'usou o endpoint de declaração protegida');
  assert.equal(call.body.p_chamado_id,uid);
  assert.equal(call.body.p_segredo,t.secret);
  assert.equal(call.body.p_fechamento,fid);
  assert.equal(call.body.p_valor_centavos,50000);
  assert.match(root.textContent,/conferindo|conferência/i);
 }finally{t.dom.window.close();}
});
test('o servidor não transforma relato em cobrança automática e exige segredo do pedido',()=>{
 assert.match(migration,/proprietario_hash=encode\(extensions\.digest\(p_segredo,'sha256'\)/);
 assert.match(migration,/status='contestado'/);
 assert.match(migration,/comissao_centavos=null/);
 assert.match(migration,/cobranca_status='nao_gerada'/);
 assert.match(migration,/pagamento_conciliado/);
 assert.match(migration,/pix\.end_to_end_id is not null/);
 assert.match(migration,/revoke all on function/);
 assert.match(reviewFix,/cliente_resposta='confirmado'/);
 assert.match(reviewFix,/status='contestado'/);
 assert.match(reviewFix,/cobranca_status='nao_gerada'/);
});
