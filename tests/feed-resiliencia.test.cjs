const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('index.html','utf8');const fn=source.slice(source.indexOf('  async function syncProfessionalCalls('),source.indexOf('  function adFromCloud('));
test('falha da consulta secundária não apaga o pedido compatível do Patrick',async()=>{
 for(const rejects of [false,true]){
 const query=new Proxy({}, {get:(_,k)=>k==='then'?(r=>Promise.resolve({data:[]}).then(r)):()=>query});
 const c={global:{},console:{warn:()=>{}},client:{rpc:async name=>{if(name==='qf_mais_oportunidades'){if(rejects)throw Error('network');return {error:{message:'timeout'}};}return {data:[{id:'gesseiro',categoria:'cat_gesseiro'}]};},from:()=>query},DB:{profissionalById:()=>({online:false}),state:{users:{clientes:[]},requests:[]},persist:()=>{}},requestFromCloud:r=>r,rebuildCloudReviews:()=>{}};
 for(const name of ['attachPrazos','attachCallPhotos','attachLatestQuotes','attachEvaluations'])c[name]=async()=>{};
 vm.createContext(c);vm.runInContext(fn,c);await c.syncProfessionalCalls('patrick');assert.equal(c.DB.state.requests.length,1);assert.equal(c.DB.state.requests[0].id,'gesseiro');assert.equal(c.global.QFOpportunitiesError,true);
 }
});
