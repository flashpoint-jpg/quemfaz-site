const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(require.resolve('../qf-foto.js'),'utf8');

function page(){
  const dom=new JSDOM('<!doctype html><html><head></head><body><div id="app-shell"><section id="qf-pedido-facil"><form id="formulario-original"><input name="servico"></form></section></div></body></html>',{
    url:'https://quemfazservico.com.br/',runScripts:'outside-only'
  });
  const w=dom.window;
  w.DB={categories:()=>[{id:'cat_encanador',nome:'Encanador'}],state:{requests:[]}};
  w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return {w,dom};
}

test('Quem Faz Foto é opção extra: preserva o formulário existente',async()=>{
  const {w,dom}=page();
  assert.ok(w.document.querySelector('#formulario-original input[name="servico"]'));
  const entry=w.document.querySelector('#qff-entry');
  assert.ok(entry);
  assert.match(entry.textContent,/Descubra o profissional pela foto/);
  entry.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(w.document.querySelector('[role="dialog"]'));
  assert.ok(w.document.querySelector('[data-qff-login]'));
  assert.equal(w.document.querySelector('[data-qff-publish]'),null);
  dom.window.close();
});

test('Login Google volta para a origem atual e não publica pedido automaticamente',async()=>{
  const {w,dom}=page();let redirect=null;
  w.QFCloud={client:{auth:{
    getUser:async()=>({data:{user:null}}),
    signInWithOAuth:async value=>{redirect=value.options.redirectTo;return{data:{}};}
  }}};
  await w.QFFoto.open();
  w.document.querySelector('[data-qff-login]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(redirect,'https://quemfazservico.com.br/?app=1');
  assert.equal(w.sessionStorage.getItem('qff-abrir-apos-google'),'1');
  assert.equal(w.document.querySelector('[data-qff-publish]'),null);
  dom.window.close();
});

test('Conta Google: escolha manual só abre revisão e depende de confirmação',async()=>{
  const {w,dom}=page();let createCalls=0;
  w.QFCloud={
    client:{
      auth:{getUser:async()=>({data:{user:{id:'cliente-1',identities:[{provider:'google'}],user_metadata:{full_name:'Cliente Teste'}}}})},
      from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'cliente-1',tipo:'cliente',nome:'Cliente Teste',telefone:'11999998888'}})})})})
    },
    createCall:async()=>{createCalls++;throw Error('Não deveria publicar sem confirmação');}
  };
  await w.QFFoto.open();
  assert.ok(w.document.querySelector('[data-qff-manual]'));
  w.document.querySelector('[data-qff-manual]').click();
  const form=w.document.querySelector('[data-qff-publish]');
  assert.ok(form);
  assert.equal(form.elements.namedItem('consent').checked,false);
  assert.equal(createCalls,0);
  assert.ok(w.document.querySelector('#formulario-original'));
  dom.window.close();
});
