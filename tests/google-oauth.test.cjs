const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const {webcrypto}=require('node:crypto');
const {TextEncoder,TextDecoder}=require('node:util');
const atendimento=fs.readFileSync(require.resolve('../qf-atendimento.js'),'utf8');
const acesso=fs.readFileSync(require.resolve('../qf-cliente-acesso.js'),'utf8');

function storage(){
 const data=new Map();
 return {getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
}
function indexedDB(){
 const keys=new Map();
 return {keys,open(){
  const db={
   createObjectStore(){},
   close(){},
   transaction(){
    const tx={oncomplete:null,onerror:null,onabort:null};
    const req=(action)=>{
     const r={onsuccess:null,onerror:null,result:null};
     queueMicrotask(()=>{
      r.result=action();
      r.onsuccess?.();
      queueMicrotask(()=>tx.oncomplete?.());
     });
     return r;
    };
    tx.objectStore=()=>({
     put:(val,k)=>req(()=>{keys.set(k,val);return k;}),
     get:k=>req(()=>keys.get(k)),
     delete:k=>req(()=>{keys.delete(k);return undefined;})
    });
    return tx;
   }
  };
  const request={result:db,onupgradeneeded:null,onsuccess:null,onerror:null};
  queueMicrotask(()=>{request.onupgradeneeded?.();request.onsuccess?.();});
  return request;
 }};
}
function page(shared={}){
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://quemfazservico.com.br/'});
 const w=dom.window;
 Object.defineProperty(w,'crypto',{configurable:true,value:webcrypto});
 Object.defineProperty(w,'indexedDB',{configurable:true,value:shared.idb||indexedDB()});
 Object.defineProperty(w,'sessionStorage',{configurable:true,value:shared.store||storage()});
 Object.defineProperty(w,'localStorage',{configurable:true,value:shared.local||storage()});
 w.DB={state:{categories:[]},categories:()=>[{id:'cat_faxina',nome:'Faxina'}],categoryById:()=>null,persist:()=>{}};
 w.Screens={authLogin:()=>'',afterRenderAnon:()=>{}};
 const context={window:w,TextEncoder,TextDecoder,console,Uint8Array,Date};
 vm.runInNewContext(atendimento,context,{filename:'qf-atendimento.js'});
 vm.runInNewContext(acesso,context,{filename:'qf-cliente-acesso.js'});
 return w;
}
test('Google: rascunho AES-GCM restaurado sem respostas em texto puro',async()=>{
 const shared={store:storage(),idb:indexedDB()};
 const first=page(shared);
 first.document.body.innerHTML=first.QFAtendimento.html();
 await first.QFAtendimento.mount(first.document.body,{},null);
 const input=first.document.querySelector('#at-servico');
 assert.ok(input);
 input.value='Faxina';
 first.document.querySelector('[data-qf-atendimento] form').dispatchEvent(new first.Event('submit',{bubbles:true,cancelable:true}));
 assert.ok(first.QFAtendimento.hasActiveDraft());
 await first.QFAtendimento.saveDraftForGoogle();
 const encrypted=shared.store.getItem('qf_google_draft_v1');
 assert.ok(encrypted);
 assert.equal(encrypted.includes('Faxina'),false);
 assert.equal(shared.idb.keys.get('oauth').extractable,false);
 const second=page(shared);
 assert.equal(second.QFAtendimento.hasGoogleDraft(),true);
 second.document.body.innerHTML=second.QFAtendimento.html();
 await second.QFAtendimento.mount(second.document.body,{embedded:true,service:''},null);
 assert.ok(second.QFAtendimento.hasActiveDraft());
 assert.ok(second.document.querySelector('#at-aceite_app')); // próxima pergunta preservada
 assert.equal(second.QFAtendimento.hasGoogleDraft(),false);
 assert.equal(shared.idb.keys.has('oauth'),false);
 first.close();second.close();
});
test('Google: conclui perfil existente com JWT antes de publicar, sem vincular telefone por conta própria',async()=>{
 const w=page();
 let phone='',calls=0,synced=0;
 const user={id:'11111111-1111-4111-8111-111111111111',identities:[{provider:'google'}]};
 w.QFCloud={
  client:{
   auth:{getUser:async()=>({data:{user},error:null})},
   from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:user.id,tipo:'cliente',nome:'Teste',telefone:phone,whatsapp:phone},error:null})})})}),
   functions:{invoke:async(slug,{body})=>{
    assert.equal(slug,'quemfaz-cliente-conta');
    assert.equal(body.acao,'google');
    assert.equal(body.telefone,'11987654321');
    calls++;phone='11987654321';
    return {data:{ok:true},error:null};
   }}
  },
  syncForCurrentSession:async()=>{synced++;}
 };
 const result=await w.QFClienteAcesso.authenticate({nome:'Teste',telefone:'11987654321'});
 assert.equal(result.id,user.id);
 assert.equal(calls,1);
 assert.equal(synced,1);
 w.close();
});
test('Google: telefone de outra conta exige acesso original e não vincula automaticamente',async()=>{
 const w=page();
 let signedOut=0;
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.QFCloud={
  client:{
   auth:{
    getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111',identities:[{provider:'google'}]}},error:null}),
    signOut:async()=>{signedOut++;return {error:null};}
   },
   from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})}),
   functions:{invoke:async()=>({data:{ok:false,error:'Este telefone pertence a outro cadastro.',codigo:'telefone_cadastrado'},error:null})}
  }
 };
 const pending=w.QFClienteAcesso.authenticate({nome:'Teste',telefone:'11987654321',container:w.document.body});
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(signedOut,1);
 assert.ok(w.document.querySelector('.qf-client-access [name="senha"]'),'oferece login da conta original');
 assert.match(w.document.querySelector('.qf-client-access [role="alert"]').textContent,/Escolha a mesma conta Google/,'explica por que o login não foi aceito');
 w.document.querySelector('[data-access-cancel]').click();
 await assert.rejects(pending,/pedido continua preenchido/);
 w.close();
});

test('Google: retorno OAuth sempre usa site oficial sem hash nem localhost',async()=>{
 const w=page();
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 let options=null;
 w.QFCloud={
  client:{
   auth:{
    getUser:async()=>({data:{user:null},error:null}),
    signInWithOAuth:async args=>{options=args;return {error:null};}
   }
  }
 };
 const pending=w.QFClienteAcesso.authenticate({nome:'Cliente',telefone:'11987654321',container:w.document.body});
 await new Promise(resolve=>setTimeout(resolve,20));
 const login=w.document.querySelector('[data-google-login]');
 assert.ok(login);
 login.click();
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(options.provider,'google');
 assert.equal(options.options.redirectTo,'https://quemfazservico.com.br/?app=1');
 assert.equal(options.options.queryParams.prompt,'select_account');
 w.document.querySelector('[data-access-cancel]').click();
 await assert.rejects(pending,/pedido continua preenchido/);
 w.close();
});

test('Google: conta mostra nome, abre pedidos vinculados e permite sair',async()=>{
 const script=fs.readFileSync(require.resolve('../qf-pedido-home.js'),'utf8');
 const dom=new JSDOM('<!doctype html><html><body><div id="app-shell"><div class="qf-landing-copy"><form data-landing-service-form><input data-landing-service-search></form></div></div></body></html>',{url:'https://quemfazservico.com.br/?app=1'});
 const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};
 const userId='11111111-1111-4111-8111-111111111111';
 const requestId='22222222-2222-4222-8222-222222222222';
 let connected=true;
 w.PROAKI_APP={};
 w.Screens={landing:()=>'',clienteHomeRender:()=>'',afterRender:()=>{},afterRenderAnon:()=>{}};
 w.QFClienteAcesso={};
 w.QFAtendimento={hasGoogleDraft:()=>false};
 w.DB={categories:()=>[{id:'cat_pintor',nome:'Pintor'}],categoryById:()=>null,state:{requests:[{id:requestId,clienteId:userId,titulo:'Pintar sala',status:'aberto',criadoEm:new Date().toISOString()}]}};
 w.navigate=()=>{};
 w.QFCloud={
  syncForCurrentSession:async()=>connected?{role:'cliente',user:{id:userId,nome:'Cliente Teste'}}:null,
  client:{
   auth:{
    getUser:async()=>({data:{user:connected?{id:userId,email:'teste@example.com',app_metadata:{provider:'google'},identities:[{provider:'google'}],user_metadata:{full_name:'Cliente Teste'}}:null},error:null}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    signOut:async()=>{connected=false;return {error:null};}
   },
   from:table=>table==='qf_profiles'?{
    select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:userId,tipo:'cliente',nome:'Cliente Teste'},error:null})})})
   }:{
    select:()=>({eq:()=>({order:()=>({limit:async()=>({data:[{id:requestId,titulo:'Pintar sala',status:'aberto',cidade:'São Paulo',bairro:'Centro',criado_em:new Date().toISOString()}],error:null})})})})
   }
  }
 };
 vm.runInNewContext(script,{window:w,console,Date},{filename:'qf-pedido-home.js'});
 await new Promise(resolve=>setTimeout(resolve,240));
 const account=w.document.querySelector('.qf-account-strip');
 assert.ok(account,'mostra barra da conta conectada');
 assert.match(account.textContent,/Olá, Cliente Teste/);
 assert.ok(w.document.querySelector('[data-account-signout]'));
 w.document.querySelector('[data-account-orders]').click();
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.match(w.document.querySelector('#qf-pedido-facil').textContent,/Pintar sala/);
 w.document.querySelector('[data-account-signout]').click();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(w.document.querySelector('.qf-account-strip'),null,'apaga identificação após sair');
 dom.window.close();
});

test('Google: perfil existente sem qf_role não deve impedir sincronização',async()=>{
 const path=require('node:path');
 const code=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const build=fs.readFileSync(path.join(__dirname,'../scripts/build-client.cjs'),'utf8');
 assert.match(build,/googleRoleBefore/);
 assert.match(build,/googleIdentity/);
 const a=code.indexOf('async function ensureProfile(');
 const b=code.indexOf('async function syncLocalUser(',a);
 assert.ok(a>0&&b>a);
 const src=code.slice(a,b).replace('const role = expectedRole || meta.qf_role;',
  "const googleIdentity = user.app_metadata?.provider === 'google' || (Array.isArray(user.identities) && user.identities.some(i => i.provider === 'google')); const role = expectedRole || meta.qf_role || (googleIdentity ? 'cliente' : null);");
 let called=0;
 const client={from:table=>{
  assert.equal(table,'qf_profiles');called++;
  return {select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'abc',tipo:'cliente',nome:'Cliente Teste'},error:null})})})};
 }};
 const context={client,console};
 vm.runInNewContext(src+'; globalThis.ensureProfileTest=ensureProfile;',context);
 const user={id:'abc',email:'teste@example.com',user_metadata:{full_name:'Cliente Teste'},app_metadata:{provider:'google'},identities:[{provider:'google'}]};
 const result=await context.ensureProfileTest(user,null,null);
 assert.equal(result.tipo,'cliente');assert.equal(called,1);
});
test('Google: sessão inicial atrasada ainda mostra nome no topo',async()=>{
 const dom=new JSDOM('<!doctype html><html><body><div id="app-shell" data-route="inicio"><div id="app-content"><div class="qf-landing-copy"><form data-landing-service-form><input data-landing-service-search></form></div></div></div></body></html>',{url:'https://quemfazservico.com.br/?app=1'});
 const w=dom.window;w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.PROAKI_APP={};w.Screens={landing:()=>'',clienteHomeRender:()=>'',afterRender:()=>{},afterRenderAnon:()=>{}};
 w.QFClienteAcesso={};w.QFAtendimento={hasGoogleDraft:()=>false};
 w.DB={categories:()=>[{id:'cat_pintor',nome:'Pintor'}],categoryById:()=>null,state:{requests:[]}};
 w.navigate=()=>{};
 const source=fs.readFileSync(require.resolve('../qf-pedido-home.js'),'utf8');
 vm.runInNewContext(source,{window:w,console,Date},{filename:'qf-pedido-home.js'});
 await new Promise(resolve=>setTimeout(resolve,130));
 assert.equal(w.document.querySelector('#qf-connected-header'),null);
 w.QFCloud={client:{
  auth:{getUser:async()=>({data:{user:{id:'abcd',email:'teste@example.com',user_metadata:{full_name:'Cliente Google'},app_metadata:{provider:'google'},identities:[{provider:'google'}]}},error:null}),onAuthStateChange:()=>({data:{subscription:{}}})},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'abcd',tipo:'cliente',nome:'teste@example.com'},error:null})})})})
 }};
 await new Promise(resolve=>setTimeout(resolve,700));
 const top=w.document.querySelector('#qf-connected-header');
 assert.ok(top,'conta aparece mesmo quando QFCloud carregou depois');
 assert.match(top.textContent,/Olá, Cliente Google/);
 assert.equal(w.document.querySelector('#qf-pedido-facil .qf-home-auth-wrap')?.hidden,true);
 w.close();
});

test('Google: pedido cifrado sobrevive retorno em outra aba sem sessionStorage',async()=>{
 const shared={store:storage(),local:storage(),idb:indexedDB()};
 const first=page(shared);
 first.document.body.innerHTML=first.QFAtendimento.html();
 await first.QFAtendimento.mount(first.document.body,{},null);
 const input=first.document.querySelector('#at-servico');
 input.value='Faxina';
 first.document.querySelector('[data-qf-atendimento] form').dispatchEvent(new first.Event('submit',{bubbles:true,cancelable:true}));
 await first.QFAtendimento.saveDraftForGoogle();
 assert.ok(shared.local.getItem('qf_google_draft_v1'));
 assert.equal(shared.local.getItem('qf_google_draft_v1').includes('Faxina'),false);
 const second=page({...shared,store:storage()});
 assert.equal(second.QFAtendimento.hasGoogleDraft(),true,'o novo contexto encontra o rascunho cifrado');
 second.document.body.innerHTML=second.QFAtendimento.html();
 await second.QFAtendimento.mount(second.document.body,{embedded:true,service:''},null);
 assert.ok(second.QFAtendimento.hasActiveDraft(),'não recomeça o formulário');
 assert.equal(second.QFAtendimento.hasGoogleDraft(),false,'apaga os dados cifrados após restauração bem-sucedida');
 assert.equal(shared.idb.keys.has('oauth'),false,'remove chave criptográfica temporária');
 first.close();second.close();
});
test('Google: pedido em andamento tem prioridade sobre Meus pedidos',()=>{
 const script=fs.readFileSync(require.resolve('../qf-pedido-home.js'),'utf8');
 assert.match(script,/function pendingPublication\(\)/);
 assert.match(script,/returned&&state.mode==='intro'&&!pendingPublication\(\)/);
 assert.match(script,/pendingPublication\(\)&&g.QFAtendimento\?\.hasActiveDraft/);
 const service=fs.readFileSync(require.resolve('../qf-atendimento.js'),'utf8');
 assert.match(service,/Pedido recuperado! Confira os dados/);
 assert.doesNotMatch(service,/if\(fromGoogle&&reuse&&oldDraft.oauth[\s\S]{0,350}await publish\(\)/);
});


test('Google: retorno OAuth com pedido salvo mostra nome e Sair sem perder formulário',async()=>{
 const script=fs.readFileSync(require.resolve('../qf-pedido-home.js'),'utf8');
 const dom=new JSDOM('<!doctype html><html><body><div id="app-shell" data-route="inicio"><div id="app-content"><div class="qf-landing-copy"><form data-landing-service-form><input data-landing-service-search></form></div></div></div></body></html>',{url:'https://quemfazservico.com.br/?app=1#/'});
 const w=dom.window;
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 w.PROAKI_APP={};
 w.DB={categories:()=>[{id:'cat_pintor',nome:'Pintor'}],categoryById:()=>null,state:{requests:[]}};
 w.Screens={landing:()=>'',clienteHomeRender:()=>'',afterRender:()=>{},afterRenderAnon:()=>{},authLogin:()=>''};
 w.QFClienteAcesso={};
 let connected=true,mounted=0;
 w.QFAtendimento={hasGoogleDraft:()=>true,hasActiveDraft:()=>true,html:()=>'<section data-qf-atendimento>Pedido mantido em revisão</section>',mount:()=>{mounted++;}};
 w.sessionStorage.setItem('qf_google_login_return','1');
 w.sessionStorage.setItem('qf_google_publish_pending','1');
 w.QFCloud={client:{
  auth:{
   getUser:async()=>({data:{user:connected?{id:'11111111-1111-4111-8111-111111111111',email:'cliente@example.com',identities:[{provider:'google'}],user_metadata:{full_name:'Cliente Teste'}}:null},error:null}),
   onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
   signOut:async()=>{connected=false;return {error:null};}
  },
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'11111111-1111-4111-8111-111111111111',tipo:'cliente',nome:'cliente@example.com'},error:null})})})})
 }};
 w.navigate=()=>{};
 vm.runInNewContext(script,{window:w,console,Date},{filename:'qf-pedido-home.js'});
 await new Promise(resolve=>setTimeout(resolve,300));
 const header=w.document.querySelector('#qf-connected-header');
 assert.ok(header,'a sessão Google é observada mesmo ao restaurar rascunho');
 assert.match(header.textContent,/Olá, Cliente Teste/);
 assert.ok(header.querySelector('[data-account-signout]'),'botão sair visível durante a revisão');
 assert.match(w.document.querySelector('#qf-pedido-facil').textContent,/Pedido mantido em revisão/);
 header.querySelector('[data-account-signout]').click();
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(connected,false,'o logout foi efetuado');
 assert.match(w.document.querySelector('#qf-pedido-facil').textContent,/Pedido mantido em revisão/,'não apaga o pedido ao sair');
 assert.ok(mounted>=1);
 dom.window.close();
});
test('Google: ação de conclusão na função publicada exige JWT e vínculo de telefone',()=>{
 const server=fs.readFileSync(require.resolve('../supabase/functions/quemfaz-cliente-conta/index.ts'),'utf8');
 assert.match(server,/case "google": return await completarGoogle\(req, b, ipHash\)/);
 assert.match(server,/const user = await usuarioDoJwt\(req\)/);
 assert.match(server,/if \(existing && existing\.id !== user\.id\)/);
 const form=fs.readFileSync(require.resolve('../qf-atendimento.js'),'utf8');
 assert.match(form,/O pedido ainda não foi publicado\./);
 assert.match(form,/Seus dados continuam preenchidos\./);
});
