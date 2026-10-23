const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild');
const base=fs.readFileSync('supabase/functions/quemfaz-efi-checkout/index.ts','utf8');
async function fixture({owner='pro',value=3990,method='pix',completed=false,paid='39.90',original='39.90',txidMismatch=false}={}){
 let handler;const updates=[],requests=[];const id='00000000-0000-4000-8000-000000000001',txid=id.replace(/-/g,'');
 const row={id,profissional_id:owner,valor_centavos:value,metodo:method,status:'pendente',plano:'livre'};
 const admin={auth:{getUser:async()=>({data:{user:{id:'pro'}}})},from:()=>{const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:row}),update:u=>{updates.push(u);Object.assign(row,u);return chain;},then:f=>Promise.resolve({error:null}).then(f)};return chain;}};
 let src=base.replace(/^import .*;$/gm,'').replace(/function pixClient\(\)\{[\s\S]*?\n\}\n\nasync function pixToken/, 'function pixClient(){return {close(){}};}\n\nasync function pixToken');
 const context={createClient:()=>admin,forge:{},Deno:{env:{get:()=> 'fixture'},serve:h=>handler=h},Request,Response,console,btoa,fetch:async(url,options)=>{
  requests.push({url,options});
  if(url.endsWith('/oauth/token'))return Response.json({access_token:'fixture'});
  if(url.includes('/v2/cob/'))return Response.json(completed?{status:'CONCLUIDA',txid:txidMismatch?'wrong':txid,valor:{original},pix:[{valor:paid}]}:{status:'ATIVA',loc:{id:100}});
  if(url.endsWith('/qrcode'))return Response.json({qrcode:'000201-fixture-pix',imagemQrcode:'data:image/png;base64,AAAA'});
  throw Error('unexpected fixture request');
 }};
 vm.runInNewContext(transformSync(src,{loader:'ts',format:'cjs',target:'es2022'}).code,context);
 const response=await handler(new Request('https://fixture/checkout',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({tipo:'recarga',pagamento_id:id})}));
 return {status:response.status,result:await response.json(),updates,requests};
}
test('Efí Pix: QR/copia e cola por R$39,90 sem ativação antecipada',async()=>{
 const f=await fixture();assert.equal(f.status,200);assert.equal(f.result.status,'pendente');assert.equal(f.result.pix_copy_paste,'000201-fixture-pix');assert.ok(f.result.qr_image);assert.ok(f.updates.every(u=>u.status!=='aprovado'));
 const charge=f.requests.find(r=>r.options.method==='PUT');const payload=JSON.parse(charge.options.body);assert.equal(payload.valor.original,'39.90');assert.match(payload.solicitacaoPagador,/Quem Faz Livre/);
});
test('Efí Pix: confirmação servidor valida valor, txid e montante efetivamente pago',async()=>{
 const ok=await fixture({completed:true});assert.equal(ok.result.status,'aprovado');assert.ok(ok.updates.some(u=>u.status==='aprovado'));
 for(const args of [{paid:'1.00'},{original:'1.00'},{txidMismatch:true}]){const f=await fixture({completed:true,...args});assert.equal(f.status,503);assert.equal(f.updates.length,0);}
});
test('Efí Pix: recusa outro titular, preço alterado e cartão no Livre',async()=>{
 assert.equal((await fixture({owner:'other'})).status,403);
 for(const args of [{value:100},{method:'cartao'}]){const f=await fixture(args);assert.equal(f.status,400);assert.equal(f.requests.length,0);}
});
