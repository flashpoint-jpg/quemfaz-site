const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),{transformSync}=require('esbuild');
const source=fs.readFileSync('supabase/functions/quemfaz-marketing-dedicado/index.ts','utf8');
test('publicação integra rota, menu e scripts versionados ao administrativo real',()=>{
 const html=fs.readFileSync('dist/admin.html','utf8');
 assert.ok(html.includes("pattern: '/admin/marketing-dedicado'"));
 assert.ok(html.includes("label: 'Marketing Dedicado'"));
 assert.match(html,/qf-pix-financeiro\.js\?v=/);assert.match(html,/qf-marketing-dedicado\.js\?v=/);
});
async function fixture({action='checkout',price=55000,blocked=false,completed=false,amount='550.00',validE2E=true,authorized=true}={}){
 let handler;const calls=[],writes=[],txid='a'.repeat(32),id='00000000-0000-4000-8000-000000000001';
 const src=source.replace(/\r\n/g,'\n').replace(/^import .*;$/gm,'').replace(/function client\(\)\{[\s\S]*?\n\}\nasync function token/,'function client(){return {close(){}};}\nasync function token');
 const admin={auth:{getUser:async()=>({error:authorized?null:Error('no'),data:{user:authorized?{id}:null}})},rpc:async(name,args)=>{
  writes.push({name,args});if(name==='qf_md_pagamento_preparar')return {data:blocked?{ok:false,reason:'integracao_entrega_pendente'}:{ok:true,id,txid,status:'pix_pronto',valor_centavos:price}};
  return {data:{ok:true,status:name==='qf_md_pagamento_liquidar'?'conciliado':'pix_pronto'}};
 }};
 const context={createClient:()=>admin,Deno:{env:{get:n=>n==='EFI_SANDBOX'?'false':'fixture'},serve:fn=>handler=fn},forge:{},Request,Response,AbortSignal,btoa,console,fetch:async(url,options)=>{
  calls.push({url,method:options.method});
  if(url.endsWith('/oauth/token'))return Response.json({access_token:'fixture'});
  if(url.includes('/v2/cob/'))return Response.json(completed?{txid,status:'CONCLUIDA',valor:{original:amount},pix:[{valor:amount,endToEndId:validE2E?'E12345678901234567890':''}]}:{txid,status:'ATIVA',valor:{original:amount},loc:{id:1}});
  if(url.endsWith('/qrcode'))return Response.json({qrcode:'000201'+('0'.repeat(40))});
  throw Error('unexpected request');
 }};
 vm.runInNewContext(transformSync(src,{loader:'ts',format:'cjs'}).code,context);
 const r=await handler(new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({action,campanha_id:id,confirmar_preco:price})}));
 return {status:r.status,data:await r.json(),calls,writes};
}
test('venda sem entrega validada e usuário sem autenticação não chegam ao banco',async()=>{
 const blocked=await fixture({blocked:true});assert.equal(blocked.status,409);assert.equal(blocked.calls.length,0);
 const unauth=await fixture({authorized:false});assert.equal(unauth.status,401);assert.equal(unauth.calls.length,0);
});
test('adicional e conjunto passam o preço exato consentido; consulta não cria Pix',async()=>{
 for(const [price,amount] of [[55000,'550.00'],[58990,'589.90']]){
  const f=await fixture({price,amount});assert.equal(f.data.valor_centavos,price);assert.equal(f.writes[0].args.p_valor,price);assert.equal(f.data.status,'pix_pronto');
 }
 const s=await fixture({action:'status'});assert.equal(s.calls.some(c=>c.method==='PUT'),false);assert.equal(s.writes.some(c=>c.name==='qf_md_pagamento_liquidar'),false);
});
test('liquidação do adicional exige txid, valor e E2E bancário',async()=>{
 const good=await fixture({completed:true});assert.equal(good.data.status,'conciliado');
 for(const opts of [{validE2E:false},{amount:'1.00'}]){const f=await fixture({completed:true,...opts});assert.equal(f.status,503);assert.ok(!f.writes.some(w=>w.name==='qf_md_pagamento_liquidar'));}
});
test('atribuição persiste após consentimento por sete dias e não guarda dados pessoais',()=>{
 const token='a'.repeat(48),dom=new JSDOM('<html><head></head><body><main id="app-content"></main></body></html>',{url:'https://example.test/?md='+token,runScripts:'outside-only'});
 const w=dom.window;w.Screens={};w.eval(fs.readFileSync('qf-marketing-dedicado.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 assert.equal(w.QFMarketingDedicado.attribution().md_token,undefined);
 w.document.querySelector('[data-md-consent]').click();assert.equal(w.QFMarketingDedicado.attribution().md_token,token);
 const saved=JSON.parse(w.localStorage.getItem('qf_md_atribuicao_v1'));assert.equal(Object.keys(saved).sort().join(','),'consentido_em,expira,token');
 w.localStorage.setItem('qf_md_atribuicao_v1',JSON.stringify({...saved,expira:Date.now()-1}));assert.equal(w.QFMarketingDedicado.attribution().md_token,undefined);dom.window.close();
});

