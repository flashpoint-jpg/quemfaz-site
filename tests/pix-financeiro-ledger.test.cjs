const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {totals,csv}=require('../qf-pix-financeiro.js');
test('valores previstos e sem E2E não entram em receita nem em saldo de repasse',()=>{
 const value={valor_centavos:10000,comissao_centavos:1300,profissional_centavos:8700};
 const paid={...value,status:'pago',end_to_end_id:'E1234567890123456',confirmado_em:'2026-10-29'};
 const t=totals([{...value,status:'pix_pronto'},paid,{...paid,status:'bloqueado'},{...value,status:'pago'},
 {...paid,status:'repassado',repassado_em:'2026-10-29',repasse_referencia:'banco',repasse_comprovante:'comprovante'}]);
 assert.equal(t.recebidos,20000);assert.equal(t.comissao,2600);assert.equal(t.obrigacao,8700);assert.equal(t.repassados,8700);
 assert.equal(t.aguardando,1);assert.equal(t.analise,1);
});
test('exportação neutraliza fórmulas recebidas nos dados',()=>{
 assert.match(csv([{profissional:'=HYPERLINK("ruim")'}]),/"'=HYPERLINK/);
});
test('abrir o financeiro monta o livro antes da tabela de pedidos e não chama ativação ou emissão',async()=>{
 const dom=new JSDOM('<html><head></head><body><main id="app-content"><div class="view"></div></main></body></html>',{runScripts:'outside-only',url:'https://example.test/admin.html#/admin/financeiro'});
 const w=dom.window,calls=[];w.Screens={};w.QFAdminCloud={client:{rpc:async name=>{calls.push(name);return {data:name==='qf_operacao_financeira_admin'?{}:[]};}}};
 w.QFComissao13={mountPixAdmin:(view,c)=>w.QFPixFinanceiro.mount(view,c)};
 w.eval(fs.readFileSync('qf-pix-financeiro.js','utf8'));w.eval(fs.readFileSync('qf-admin-financeiro.js','utf8'));
 w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await new Promise(r=>setTimeout(r,15));
 const view=w.document.querySelector('.view');assert.ok(view.firstElementChild.hasAttribute('data-qff-pix-host'));
 assert.match(view.firstElementChild.textContent,/Pagamentos dos serviços \(Plano Livre\)/);
 assert.ok(calls.includes('qf_livre_manual_pix_admin_ledger'));assert.ok(!calls.some(n=>/preparar|solicitar_pix|liquidar/.test(n)));
 dom.window.close();
});
