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
test('atualização rápida continua detectando pedidos novos quando oportunidades falha',async()=>{
 const fn=source.slice(source.indexOf('  async function professionalQuickSignature()'),source.indexOf('\n  let publicAdsSync',source.indexOf('  async function professionalQuickSignature()')));
 for(const rejects of [false,true]){
 let rows=[{id:'pedido1',status:'aberto',participantes:0,limite:4}];
 const ctx={client:{rpc:async name=>{if(name==='qf_mais_oportunidades'){if(rejects)throw Error('network');return {error:{message:'timeout'}};}return {data:rows};},from:()=>({select:async()=>({data:[]})})}};
 vm.createContext(ctx);vm.runInContext(fn,ctx);const before=await ctx.professionalQuickSignature();rows=[{id:'pedido2',status:'aberto',participantes:0,limite:4}];assert.notEqual(before,await ctx.professionalQuickSignature());assert.match(before,/consulta_indisponivel/);
 }
});
test('catálogo privado só é consultado depois de autenticar',async()=>{
 const start=source.indexOf('  function carregarPrecosAutenticado('),end=source.indexOf('})(window);',start);const snippet=source.slice(start,end);
 let session=null,callback;const calls=[];
 const ctx={client:{auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>callback=fn},from:table=>{calls.push(table);return {select:async()=>({data:[{categoria:'padrao',preco_centavos:800}]})};}},QFPrecos:{aplicar:()=>{}},PRECOS_KEY:'precos',localStorage:{setItem:()=>{}},setTimeout:fn=>fn()};
 vm.createContext(ctx);vm.runInContext(snippet,ctx);await new Promise(r=>setImmediate(r));assert.equal(calls.length,0);callback('SIGNED_IN',{access_token:'fixture'});await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['qf_precos_desbloqueio']);callback('SIGNED_OUT',null);assert.equal(calls.length,1);
});
