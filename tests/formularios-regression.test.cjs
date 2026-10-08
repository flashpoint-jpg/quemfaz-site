const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync('index.html','utf8'),source=fs.readFileSync('qf-location-autocomplete.js','utf8');
const data=JSON.parse(fs.readFileSync('data/localidades.json'));
function api(){const ctx={window:{}};vm.createContext(ctx);vm.runInContext(source,ctx);return ctx.window.QFLocationAutocomplete;}
test('cidade digitada completa UF apenas com município inequívoco',()=>{
 const a=api();assert.equal(a.exactRegion(data,'sao paulo').uf,'SP');
 assert.equal(a.exactRegion(data,'Santo André'),null);
 assert.equal(a.exactRegion(data,'Santo André / SP').uf,'SP');
 assert.equal(a.exactRegion(data,'Santo André','PB').uf,'PB');
 assert.equal(a.exactRegion(data,'São Paulo','RJ'),null);
});
function draftContext(region){
 const ctx={homeLocation:{value:'São Paulo'},homeRegion:null,homeNeighborhood:{value:' Vila Mariana '},landingSearch:{value:'Pintor'},locationAutocomplete:{resolveRegion:async()=>region},global:{}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('      async function saveHomeDraft(){'),html.indexOf('      function landingNorm(')),ctx);return ctx;
}
test('passagem da home aguarda resolução e preserva bairro',async()=>{
 const ctx=draftContext({cidade:'São Paulo',uf:'SP'});await ctx.saveHomeDraft();
 assert.equal(ctx.global.QFHomeDraft.region.uf,'SP');assert.equal(ctx.global.QFHomeDraft.region.bairro,'Vila Mariana');
});
test('cidade ambígua não segue para formulário com UF vazia',async()=>{
 const ctx=draftContext(null);ctx.homeLocation.value='Santo André';
 await assert.rejects(ctx.saveHomeDraft(),/Selecione sua cidade e o estado/);assert.equal(ctx.global.QFHomeDraft,undefined);
});
function sessionContext(error){
 const effects={logout:0,cleared:0,session:'previous'};
 const ctx={enabled:true,syncing:null,lastSyncAt:0,prepareLocalState:()=>{},refreshPublicAdsInBackground:()=>{},DB:{getSession:()=>effects.session,setSession:s=>effects.session=s},clearRuntimeData:()=>effects.cleared++,client:{auth:{getSession:async()=>({error}),signOut:async opts=>{assert.equal(opts.scope,'local');effects.logout++;return {};}}},global:{QFConnection:{deadline:p=>p},PU:{toast:()=>{}}}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('  function isInvalidStoredSession('),html.indexOf('  function traduzErroAuth(')),ctx);return {ctx,effects};
}
test('sessão revogada libera nova entrada no aparelho',async()=>{
 const {ctx,effects}=sessionContext({code:'refresh_token_not_found'});assert.equal(await ctx.syncForCurrentSession(true),null);
 assert.equal(effects.logout,1);assert.equal(effects.session,null);assert.equal(effects.cleared,1);
});
test('erro temporário de rede ou servidor não encerra sessão',async()=>{
 for(const error of [{code:'unexpected_failure'},{code:'fetch_error'},{message:'timeout'}]){
  const {ctx,effects}=sessionContext(error);await assert.rejects(ctx.syncForCurrentSession(true));
  assert.equal(effects.logout,0);assert.equal(effects.session,'previous');assert.equal(effects.cleared,0);
 }
});
