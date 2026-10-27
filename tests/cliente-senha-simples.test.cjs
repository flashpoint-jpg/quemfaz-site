const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const esbuild=require('esbuild');
test('Conta de cliente aceita senha simples só numérica ou só letras no servidor',async()=>{
 const source=fs.readFileSync('supabase/functions/quemfaz-cliente-conta/index.ts','utf8').replace(/^import .*;\n/gm,'');
 const created=[];let handler;
 const query=new Proxy({then(resolve){resolve({error:null,count:0,data:null});}},{get(t,p){return p in t?t[p]:()=>query;}});
 const client={from:()=>query,rpc:async()=>({data:[],error:null}),auth:{admin:{createUser:async args=>{created.push(args);return {data:{user:{id:'00000000-0000-4000-8000-000000000001'}},error:null};}},signInWithPassword:async()=>({data:{session:{access_token:'fixture',refresh_token:'fixture'}},error:null})}};
 const context={Deno:{env:{get:k=>k==='RESEND_API_KEY'?'':'fixture'},serve:fn=>{handler=fn;}},createClient:()=>client,crypto:crypto.webcrypto,TextEncoder,Uint8Array,Date,Response,Request,URL,btoa,console:{error:()=>{}}};
 vm.runInNewContext(esbuild.transformSync(source,{loader:'ts',format:'cjs'}).code,context);
 for(const senha of ['123456','abcdef','1234567']){
  const response=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({acao:'cadastrar',nome:'Cliente Teste',telefone:'11986427539',email:'fixture@example.com',senha})}));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.equal(created.at(-1).password,senha);assert.equal(body.senha,undefined);
 }
 const short=await handler(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify({acao:'cadastrar',nome:'Cliente Teste',telefone:'11986427539',email:'fixture@example.com',senha:'12345'})}));assert.equal(short.status,400);assert.equal(created.length,3);
});
