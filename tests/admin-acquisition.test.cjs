const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
async function report(snapshot){
 const output={isConnected:true,innerHTML:''};
 const section={querySelector:()=>output};
 const calls=[];
 const window={Screens:{},PU:{escapeHtml:String},QFAdminCloud:{client:{
  from(){throw Error('A consulta direta não tem acesso administrativo');},
  rpc(name){calls.push(name);return Promise.resolve(name==='qf_client_funnel_summary'?{data:{steps:{published:6}}}:snapshot);}
 }}};
 vm.runInNewContext(fs.readFileSync('qf-admin-acquisition.js','utf8'),{window,document:{createElement:()=>section},Date,Promise,Number,Object,Array});
 window.Screens.afterRender('/admin/dashboard',{querySelector:()=>null,appendChild(){}},{},{});
 await new Promise(resolve=>setImmediate(resolve));
 return {html:output.innerHTML,calls};
}
test('painel conta pedidos administrativos recentes e separa situações',async()=>{
 const recent=new Date().toISOString(),old=new Date(Date.now()-8*86400000).toISOString();
 const r=await report({data:{chamados:[...Array.from({length:5},()=>({criado_em:recent,status:'em_negociacao'})),{criado_em:recent,status:'concluido'},{criado_em:old,status:'aberto'}]}});
 assert.match(r.html,/ainda na base<\/span><strong>6<\/strong>/);
 assert.match(r.html,/Em negociação<\/span><strong>5<\/strong>/);
 assert.match(r.html,/Concluído<\/span><strong>1<\/strong>/);
 assert.ok(r.calls.includes('qf_admin_snapshot'));
});
test('falha de acesso não vira contagem zero',async()=>{
 for(const response of [{error:{message:'forbidden'}},{data:{}}]){
  const r=await report(response);assert.match(r.html,/Contagem atual indisponível/);
  assert.doesNotMatch(r.html,/ainda na base<\/span><strong>0/);
 }
});
