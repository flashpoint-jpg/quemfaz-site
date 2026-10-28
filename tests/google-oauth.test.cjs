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
 w.document.querySelector('[data-access-cancel]').click();
 await assert.rejects(pending,/pedido continua preenchido/);
 w.close();
});
