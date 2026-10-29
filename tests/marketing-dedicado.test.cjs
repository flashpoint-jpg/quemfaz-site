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
  writes.push({name,args});if(['qf_md_pagamento_preparar','qf_md_pagamento_consultar'].includes(name))return {data:blocked?{ok:false,reason:'integracao_entrega_pendente'}:{ok:true,id,txid,status:'pix_pronto',valor_centavos:price}};
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
 const s=await fixture({action:'status'});assert.equal(s.writes[0].name,'qf_md_pagamento_consultar');assert.equal(s.calls.some(c=>c.method==='PUT'),false);assert.equal(s.writes.some(c=>c.name==='qf_md_pagamento_liquidar'),false);
});
test('liquidação do adicional exige txid, valor e E2E bancário',async()=>{
 const good=await fixture({completed:true});assert.equal(good.data.status,'conciliado');
 for(const opts of [{validE2E:false},{amount:'1.00'}]){const f=await fixture({completed:true,...opts});assert.equal(f.status,503);assert.ok(!f.writes.some(w=>w.name==='qf_md_pagamento_liquidar'));}
});
test('pedido não precisa de link, token ou armazenamento de origem',()=>{
 const dom=new JSDOM('<html><head></head><body></body></html>',{url:'https://example.test/?md='+('a'.repeat(48)),runScripts:'outside-only'});const w=dom.window;w.Screens={};w.eval(fs.readFileSync('qf-marketing-dedicado.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));assert.equal(w.document.querySelector('[data-md-consent]'),null);assert.equal(Object.keys(w.QFMarketingDedicado.attribution()).length,0);assert.match(w.QFMarketingDedicado.offer(),/primeira oferta/);dom.window.close();
});

async function panelFixture({admin=false,paid=false}={}){
 const dom=new JSDOM('<html><head></head><body><main id="app-content"><div class="view"></div></main></body></html>',{url:'https://example.test/#'+(admin?'/admin/marketing-dedicado':'/profissional/planos'),runScripts:'outside-only'});
 const w=dom.window,calls=[];w.Screens={};
 const campaign={id:'00000000-0000-4000-8000-000000000001',status:paid?'ativa':'aguardando_pagamento',pagamento_status:paid?'conciliado':'nao_emitido',categoria:'pintor',cidades:['São Paulo'],livre_pago:true,janela_min:15,urgente_min:5,leads:[],eventos:[]};
 const client={rpc:async()=>({data:{ok:true,entrega_validada:true,livre_pago:true,campanhas:[campaign]}}),functions:{invoke:async(name,args)=>{calls.push({name,args});return {data:{ok:true,status:'pix_pronto',pix_copy_paste:'000201'+'0'.repeat(50)}};}}};
 w.QFCloud={client};w.QFAdminCloud={client};w.eval(fs.readFileSync('qf-marketing-dedicado.js','utf8'));w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
 await new Promise(resolve=>setImmediate(resolve));return {dom,w,calls};
}
test('tela exige consentimento e mostra preço antes de gerar Pix; abertura não cobra',async()=>{
 const {dom,w,calls}=await panelFixture();assert.equal(calls.length,0);
 const form=w.document.querySelector('[data-md-payment]');assert.ok(form);assert.match(form.textContent,/550,00/);assert.equal(form.querySelector('input[type=checkbox]').required,true);
 assert.equal(w.document.querySelector('[data-md-link]'),null);dom.window.close();
});
test('administrativo permite pausa na gestão manual e não exige conta Meta',async()=>{
 const {dom,w}=await panelFixture({admin:true,paid:true});assert.ok(w.document.querySelector('[data-md-action=pausar]'));assert.equal(w.document.querySelector('[name=meta]').required,false);assert.equal(w.document.querySelector('[data-md-link]'),null);assert.match(w.document.body.textContent,/sem link exclusivo/);dom.window.close();
});

test('conciliação em segundo plano só consulta e exige valor, txid e E2E corretos',async()=>{
 const src=fs.readFileSync('supabase/functions/_shared/marketing-sync.ts','utf8');
 for(const mismatch of ['nenhum','valor','txid','e2e']){
  const calls=[],writes=[],exports={};const payment={id:'invoice',txid:'a'.repeat(32),valor_centavos:55000};
  const ctx={exports,module:{exports},AbortSignal,fetch:async(url,options)=>{calls.push(options.method);return Response.json({status:'CONCLUIDA',txid:mismatch==='txid'?'wrong':payment.txid,valor:{original:mismatch==='valor'?'1.00':'550.00'},pix:[{valor:'550.00',endToEndId:mismatch==='e2e'?'':'E12345678901234567890'}]});}};
  vm.runInNewContext(transformSync(src,{loader:'ts',format:'cjs'}).code,ctx);
  const admin={rpc:async(name,args)=>{writes.push({name,args});return name==='qf_md_pagamentos_pendentes'?{data:[payment]}:{data:{ok:true}};}};
  const result=await ctx.module.exports.syncMarketingDedicado(admin,{},'https://bank.example','fixture');
  assert.deepEqual(calls,['GET']);assert.equal(result.conciliados,mismatch==='nenhum'?1:0);assert.equal(writes.filter(x=>x.name==='qf_md_pagamento_liquidar').length,mismatch==='nenhum'?1:0);
 }
});
