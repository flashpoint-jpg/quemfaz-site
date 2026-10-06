const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function storage() { const m = new Map(); return { getItem: k => m.get(k), setItem: (k,v) => m.set(k,v), removeItem: k => m.delete(k) }; }
const localStorage = storage(), sessionStorage = storage(), rows = [], pixels = [], google = [];
const win = { crypto: require('node:crypto').webcrypto, addEventListener() {}, QFMarketingTouch: {source:'google',campaign:'teste'},
  QFCloud: { enabled:true, client: { from: () => ({ insert: row => { rows.push(row); return Promise.resolve({}); } }) } },
  fbq: (...args) => pixels.push(args), qfGoogleLead: id => google.push(id) };
vm.runInNewContext(fs.readFileSync(path.join(root,'qf-client-acquisition.js'),'utf8'), {
  window:win, localStorage,sessionStorage,URLSearchParams,location:{search:'',hash:'#/'},Date,Promise,console
});
const A=win.QFClientAcquisition;
for (const [service,cat] of Object.entries(A.services)) {
  assert.ok(html.includes("id: '"+cat+"'"),service);
  assert.equal(A.serviceFromLink('?utm_source=google&utm_campaign=quemfaz_clientes_servicos&utm_content='+service),cat);
}
assert.equal(A.serviceFromLink('?utm_source=google&utm_campaign=quemfaz_profissionais&utm_content=pintor'),null);
assert.equal(A.serviceFromLink('?utm_source=fb&utm_content=pintor'),null);
A.published({id:'pedido-1'},'cat_pintor'); A.published({id:'pedido-1'},'cat_pintor');
assert.equal(pixels.length,1); assert.equal(google.length,1); assert.equal(rows.length,1);
assert.equal(pixels[0][3].eventID,'qf_pedido_pedido-1');
assert.equal(rows[0].event,'published'); assert.equal(rows[0].request_id,'pedido-1');
assert.ok(!JSON.stringify(rows).includes('telefone'));
win.QFCloud.enabled=false; A.published({id:'demo'},'cat_pintor'); assert.equal(pixels.length,1);

async function run() {
  const source=html.slice(html.indexOf('  async function geocodeCity('),html.indexOf('  async function reverseGeocode('));
  const geo={global:{QFClientAcquisition:{track(){}}},fetch:()=>new Promise(()=>{}),AbortController,
    setTimeout:fn=>setTimeout(fn,5),clearTimeout,Number,String,Array,Promise};
  vm.createContext(geo);vm.runInContext(source,geo);
  assert.equal(await geo.geocodeCity('São Paulo','SP'),null,'Geocodificação travada deve liberar o pedido por cidade');

  const callSource=html.slice(html.indexOf('  async function createCall('),html.indexOf('  async function unlockCall('));
  let published=0,fail=false,inserted;
  const DB={state:{requests:[]},categoryById:()=>({nome:'Pintor'}),clienteById:()=>null,persist(){}};
  const scope={DB,cityFromId:()=>null,global:{QFClientAcquisition:{attribution:()=>({source:'google'}),published:()=>published++},QFPush:{notify:()=>new Promise(()=>{})}},
    client:{from:table=>table==='qf_chamados'?{insert:row=>{inserted=row;return {select:()=>({single:async()=>fail?{error:Error('recusado')}:{data:{id:'saved'},error:null}})};}}:{update:()=>({eq:()=>new Promise(()=>{})})}},
    requestFromCloud:r=>({id:r.id}),saveClientAddress:()=>new Promise(()=>{}),Date,Number,String,Array,Object,Promise,console};
  vm.createContext(scope);vm.runInContext(callSource,scope);
  const data={clienteId:'client',categoriaId:'cat_pintor',descricao:'Pintar parede',endereco:{cidade:'São Paulo',uf:'SP'}};
  const saved=await Promise.race([scope.createCall(data),new Promise((_,r)=>setTimeout(()=>r(Error('Tarefas auxiliares bloquearam a confirmação')),100))]);
  assert.equal(saved.id,'saved');assert.equal(published,1);assert.equal(inserted.marketing_origem.source,'google');
  fail=true;await assert.rejects(scope.createCall(data),/recusado/);assert.equal(published,1,'Insert recusado não converte');

  // A terceira resposta exibe preço e exige um clique separado para abrir o pedido.
  const a=html.indexOf('/* QuemFaz V11.31 — calculadora de preço');
  const b=html.indexOf('/* QuemFaz — casca do app, roteador por hash e navegação. */');
  const handlers={},nav=[],body={innerHTML:'',addEventListener:(k,fn)=>handlers[k]=fn,querySelector:()=>({addEventListener:(k,fn)=>handlers.pedir=fn})};
  const w={PU:{escapeHtml:String},icon:()=>'',Screens:{},scrollTo(){},navigate:p=>nav.push(p)};
  vm.runInNewContext(html.slice(html.indexOf('(function (global) {',a),b),{window:w,sessionStorage,Date,Math,Number,String,Array,Object,JSON,console});
  w.Screens.afterRenderAnon('/calculadora',{querySelector:s=>s==='[data-qf-calc-body]'?body:null},{});
  const choose=i=>handlers.click({target:{closest:s=>s==='[data-qf-calc-op]'?{getAttribute:()=>String(i)}:null}});
  choose(2);choose(0);choose(0);
  assert.match(body.innerHTML,/Estimativa do serviço/);assert.match(body.innerHTML,/R\$ \d/);assert.equal(nav.length,0);
  handlers.pedir();assert.equal(nav[0],'/auth/cliente/cadastro');
  console.log('captacao-clientes: destinos, privacidade, deduplicação, timeout, publicação e estimativa antes do pedido: ok');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
