const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function setup() {
  const storage = new Map();
  const STATUS = Object.fromEntries(['AGUARDANDO_ORCAMENTO','ORCAMENTO_ENVIADO','ORCAMENTO_RECUSADO','APROVADO','EM_ANDAMENTO','SERVICO_CONCLUIDO','PAGO','FINALIZADO','CANCELADO','NAO_SELECIONADO'].map(x=>[x,x.toLowerCase()]));
  const requests = [];
  const c = {STATUS, Screens:{}, DB:{requestsByProfissional:id=>requests.filter(r=>r.profissionalId===id),requestById:id=>requests.find(r=>r.id===id)}, PU:{escapeHtml:s=>String(s)}, icon:()=>'',servicoCard:r=>`<article data-request="${r.id}">${r.status}</article>`,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
  vm.createContext(c);
  vm.runInContext(html.slice(html.indexOf('  const ATIVOS_PROF = '),html.indexOf('\n  function servicoCard(req)')),c);
  return {c,storage,requests,render:()=>c.Screens.profServicosRender({}, {id:'pro'}),setTab:tab=>vm.runInContext(`profServiceTabs.pro='${tab}'`,c)};
}
test('somente ativos e negociação em andamento; concluído, pago e finalizado no histórico',()=>{
 const {c,requests,render,setTab}=setup();
 Object.values(c.STATUS).forEach(status=>requests.push({id:status,status,profissionalId:'pro'}));
 const active=render();
 for(const status of ['servico_concluido','pago','finalizado','cancelado','nao_selecionado']) assert.ok(!active.includes('data-request="'+status+'"'));
 assert.ok(active.includes('data-request="em_andamento"'));
 setTab('historico');const history=render();
 for(const status of ['servico_concluido','pago','finalizado']) assert.ok(history.includes('data-hide-servico="'+status+'"'));
 assert.ok(!history.includes('data-request="em_andamento"'));
});
test('remover só oculta o concluído do profissional, sem modificar registros ou finanças',()=>{
 const {c,requests,render,setTab}=setup();
 requests.push({id:'done',status:c.STATUS.SERVICO_CONCLUIDO,profissionalId:'pro',avaliacaoCliente:{nota:5},pagamento:{valor:100},comissao:{percentual:13}},{id:'active',status:c.STATUS.EM_ANDAMENTO,profissionalId:'pro'},{id:'other',status:c.STATUS.FINALIZADO,profissionalId:'outro'});
 const before=JSON.stringify(requests);
 assert.equal(c.hideProfHistory('pro','active'),false);
 assert.equal(c.hideProfHistory('pro','other'),false);
 assert.equal(c.hideProfHistory('pro','done'),true);
 assert.equal(JSON.stringify(requests),before);
 setTab('historico');assert.ok(!render().includes('data-request="done"'));
 assert.equal(c.profHiddenHistory('outro').length,0);
 // Se o pedido voltar à negociação, a preferência de histórico nunca esconde um ativo.
 requests[0].status=c.STATUS.EM_ANDAMENTO;setTab('andamento');assert.ok(render().includes('data-request="done"'));
});
test('preferência corrompida não quebra a lista e falha de armazenamento não confirma remoção',()=>{
 const {c,storage,requests}=setup();
 for(const value of ['{}','null','invalid']){storage.set('quemfaz_hidden_history_v1_profissional_pro',value);assert.equal(c.profHiddenHistory('pro').length,0);}
 requests.push({id:'done',status:c.STATUS.FINALIZADO,profissionalId:'pro'});
 c.localStorage.setItem=()=>{throw Error('quota');};assert.equal(c.hideProfHistory('pro','done'),false);
});
