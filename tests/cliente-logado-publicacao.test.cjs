const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const script=fs.readFileSync(path.join(__dirname,'../qf-cliente-acesso.js'),'utf8');

function prepare(user,profile){
 const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'https://quemfazservico.com.br/'});
 const w=dom.window;
 w.HTMLElement.prototype.scrollIntoView=()=>{};
 let syncCount=0,profileReads=0,edgeCalls=0;
 w.Screens={authLogin:()=>'LOGIN',afterRenderAnon:()=>{}};
 w.QFCloud={
  client:{
   auth:{getUser:async()=>({data:{user},error:null})},
   from:name=>{
    assert.equal(name,'qf_profiles');
    return {select:()=>({eq:()=>({maybeSingle:async()=>{
     profileReads++;
     return {data:profile,error:null};
    }})})};
   },
   functions:{invoke:async()=>{edgeCalls++;throw Error('Não deve forçar novo login.');}}
  },
  syncForCurrentSession:async()=>{syncCount++;return {role:'cliente'};}
 };
 vm.runInNewContext(script,{window:w,console,Date});
 return {w,dom,get reads(){return profileReads;},get syncs(){return syncCount;},get edgeCalls(){return edgeCalls;}};
}

test('cliente já logado pode publicar na sua conta com telefone digitado diferente, sem reautenticação',async()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const p=prepare({id,app_metadata:{provider:'google'},identities:[{provider:'google'}]},
  {id,tipo:'cliente',nome:'Cliente Teste',telefone:'11987654321',whatsapp:'11987654321'});
 const response=await p.w.QFClienteAcesso.authenticate({nome:'Cliente Teste',telefone:'21987654321',container:p.w.document.body});
 assert.equal(response.id,id);
 assert.equal(response.whatsapp,'11987654321');
 assert.equal(p.syncs,1);
 assert.equal(p.edgeCalls,0,'não tenta trocar telefone automaticamente por função privilegiada');
 assert.equal(p.w.document.querySelector('.qf-client-access'),null,'não pede login outra vez');
 p.dom.window.close();
});

test('telefone com prefixo 55 no perfil também permite reutilizar o login',async()=>{
 const id='11111111-1111-4111-8111-111111111112';
 const p=prepare({id,app_metadata:{provider:'email'}},
  {id,tipo:'cliente',nome:'Cliente',telefone:'+55 (11) 98765-4321',whatsapp:'+55 (11) 98765-4321'});
 const response=await p.w.QFClienteAcesso.authenticate({nome:'Cliente',telefone:'11987654321',container:p.w.document.body});
 assert.equal(response.id,id);
 assert.equal(p.syncs,1);
 p.dom.window.close();
});

test('conta visitante não é reutilizada como cadastro de outro telefone',async()=>{
 const id='11111111-1111-4111-8111-111111111113';
 const p=prepare({id,app_metadata:{qf_guest:true},identities:[]},
  {id,tipo:'cliente',nome:'Visitante',telefone:'11987654321',whatsapp:'11987654321'});
 const pending=p.w.QFClienteAcesso.authenticate({nome:'Novo cliente',telefone:'21987654321',container:p.w.document.body});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(p.w.document.querySelector('[data-guest-publish]'),'mantém alternativa visitante');
 assert.equal(p.syncs,0);
 p.w.document.querySelector('[data-access-cancel]').click();
 await assert.rejects(pending,/pedido continua preenchido/);
 p.dom.window.close();
});

test('o envio exige confirmação visível se celular do perfil não coincide',()=>{
 const content=fs.readFileSync(path.join(__dirname,'../qf-atendimento.js'),'utf8');
 assert.match(content,/accountPhone!==phone\\(a\\.contato\\)/);
 assert.match(content,/a\\.contato=accountPhone;/);
 assert.match(content,/Toque em Publicar grátis novamente para confirmar/);
 assert.match(content,/if\\(accountPhone\\)at\\.contato=accountPhone;/);
});
