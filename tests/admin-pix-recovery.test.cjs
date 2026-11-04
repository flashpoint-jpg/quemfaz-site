const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),esbuild=require('esbuild');
const file=require.resolve('../supabase/functions/quemfaz-admin-recuperar-pix/index.ts');
const source=fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace('Deno.serve(',"pixClient=()=>({close(){}});pixToken=async()=> 'test';Deno.serve(");
const code=esbuild.transformSync(source,{loader:'ts',format:'cjs'}).code;
async function run({authorized=true,token=true,expired=false,paid=false,mismatch=false}={}){
 let handler,reads=0,updates=0,requests=[];
 const row={id:'11111111-1111-4111-8111-111111111111',segredo:'a'.repeat(48),email:'teste@example.com',plano:'avulso',status:'pendente',valor_centavos:1499,metodo:'pix',provedor:'efi',provedor_id:'qf123',profissional_id:null};
 const cob={txid:'qf123',status:paid?'CONCLUIDA':'ATIVA',valor:{original:mismatch?'25.00':'14.99'},loc:{id:1},calendario:{criacao:new Date(Date.now()-(expired?172800000:1000)).toISOString(),expiracao:86400},pix:paid?[{valor:'14.99',endToEndId:'E12345678901234567890'}]:[]};
 const admin={auth:{getUser:async()=>({data:{user:{id:'admin'}}})},from(table){reads++;const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:table==='qf_admins'?(authorized?{user_id:'admin'}:null):row}),update(){updates++;return q;}};return q;}};
 vm.runInNewContext(code,{createClient:()=>admin,Deno:{env:{get:()=>''},serve:f=>handler=f},Response,Request,AbortSignal,console,fetch:async(url,opts)=>{requests.push({url,method:opts.method});if(opts.method==='PATCH'){const patch=JSON.parse(opts.body);cob.calendario.expiracao=patch.calendario.expiracao;}return new Response(JSON.stringify(url.includes('qrcode')?{qrcode:'PIX_RECUPERADO'}:cob),{status:200});}});
 const response=await handler(new Request('https://example.com',{method:'POST',headers:token?{Authorization:'Bearer test'}:{},body:JSON.stringify({id:row.id})}));
 return {status:response.status,data:await response.json(),requests,reads,updates};
}
test('sem token não consulta dados privados',async()=>{const r=await run({token:false});assert.equal(r.status,401);assert.equal(r.reads,0);});
test('usuário sem papel admin não acessa cobrança',async()=>{const r=await run({authorized:false});assert.equal(r.status,403);assert.equal(r.reads,1);assert.equal(r.requests.length,0);});
test('Pix ativo é recuperado só com GET',async()=>{const r=await run();assert.equal(r.data.pix_copy_paste,'PIX_RECUPERADO');assert.ok(r.requests.every(x=>x.method==='GET'));assert.equal(r.updates,0);});
test('Pix vencido renova o mesmo txid sem PUT ou nova cobrança',async()=>{const r=await run({expired:true});assert.equal(r.data.ok,true);assert.equal(r.requests.filter(x=>x.method==='PATCH').length,1);assert.ok(r.requests.every(x=>x.method!=='PUT'));assert.match(r.requests.find(x=>x.method==='PATCH').url,/qf123$/);});
test('pagamento confirmado retorna cadastro e não permite novo Pix',async()=>{const r=await run({paid:true});assert.equal(r.data.status,'aprovado');assert.equal(r.data.pix_copy_paste,'');assert.equal(r.requests.length,1);assert.equal(r.updates,1);});
test('valor divergente bloqueia recuperação e renovação',async()=>{const r=await run({expired:true,mismatch:true});assert.equal(r.status,409);assert.equal(r.data.error,'cobranca_incompativel');assert.equal(r.requests.length,1);assert.equal(r.updates,0);});
