const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(require.resolve('../qf-client-acquisition.js'),'utf8');

function page(url,referrer,searchSaved,marketing){
  const dom=new JSDOM('<!doctype html><body></body>',{url,referrer:referrer||undefined,runScripts:'outside-only'});
  const w=dom.window;
  w.crypto.randomUUID=()=> 'organic-test';
  if(searchSaved)w.sessionStorage.setItem('qf_search_referrer_v1',JSON.stringify(searchSaved));
  if(marketing)w.QFMarketingTouch=marketing;
  w.eval(fs.readFileSync(require.resolve('../qf-ai-origin.js'),'utf8'));
  w.eval(script);
  return {dom,origin:w.QFClientAcquisition.attribution(),saved:JSON.parse(w.sessionStorage.getItem('qf_search_referrer_v1')||'null')};
}

test('Google orgânico só é confirmado por referência real e guarda a landing',()=>{
  const p=page('https://quemfazservico.com.br/servicos/diarista/guarulhos/','https://www.google.com/search?q=diarista');
  assert.equal(p.origin.source,'google_referral');
  assert.equal(p.origin.medium,'organic');
  assert.equal(p.origin.landing_page,'/servicos/diarista/guarulhos/');
  assert.equal(p.saved.source,'google_referral');
  p.dom.window.close();
});

test('origem orgânica preservada após navegação interna sem referrer externo',()=>{
  const p=page('https://quemfazservico.com.br/', 'https://quemfazservico.com.br/servicos/diarista/guarulhos/',
    {source:'google_referral',medium:'organic',landing_page:'/servicos/diarista/guarulhos/'});
  assert.equal(p.origin.source,'google_referral');
  assert.equal(p.origin.medium,'organic');
  assert.equal(p.origin.landing_page,'/servicos/diarista/guarulhos/');
  p.dom.window.close();
});

test('Google orgânico substitui anúncio antigo, preserva a landing e não herda o clique pago',()=>{
  const previous={source:'google',medium:'cpc',campaign:'anuncio-anterior',gclid:'antigo'};
  const catalog=page('https://quemfazservico.com.br/servicos/','https://www.google.com.br/',null,previous);
  const next=page('https://quemfazservico.com.br/servicos/diarista/guarulhos/',
    'https://quemfazservico.com.br/servicos/',catalog.saved,previous);
  assert.deepEqual({...next.origin},{
    source:'google_referral',medium:'organic',landing_page:'/servicos/',content:'/servicos/diarista/guarulhos/'
  });
  catalog.dom.window.close();
  next.dom.window.close();
});

test('login Google, subdomínio de outro produto e origem externa não viram pesquisa orgânica',()=>{
  for(const host of ['accounts.google.com','mail.google.com','google.com.example.org','example.org']){
    const p=page('https://quemfazservico.com.br/','https://'+host+'/',{
      source:'google_referral',medium:'organic',landing_page:'/servicos/diarista/guarulhos/'
    });
    assert.equal(p.origin.source,'direto',host);
    p.dom.window.close();
  }
});

test('link direto não vira orgânico e clique pago mantém atribuição paga',()=>{
  const direct=page('https://quemfazservico.com.br/servicos/diarista/guarulhos/');
  assert.equal(direct.origin.source,'direto');
  assert.equal(direct.origin.medium,undefined);
  direct.dom.window.close();
  const paid=page('https://quemfazservico.com.br/?gclid=clique123','https://www.google.com/search?q=diarista');
  assert.equal(paid.origin.source,'google');
  assert.equal(paid.origin.medium,'cpc');
  assert.equal(paid.saved,null);
  paid.dom.window.close();
});

test('UTM do ChatGPT e referenciadores de IA são identificados sem anúncio',()=>{
  for(const [url,ref,source] of [
    ['https://quemfazservico.com.br/?utm_source=chatgpt.com','','chatgpt'],
    ['https://quemfazservico.com.br/','https://www.perplexity.ai/search/test','perplexity'],
    ['https://quemfazservico.com.br/','https://gemini.google.com/app','gemini'],
    ['https://quemfazservico.com.br/','https://copilot.microsoft.com/','copilot'],
    ['https://quemfazservico.com.br/','https://claude.ai/','claude']
  ]){
    const p=page(url,ref);assert.equal(p.origin.source,source);assert.equal(p.origin.medium,'ai_referral');p.dom.window.close();
  }
});
test('clique pago não é confundido com IA e domínio falso não é aceito',()=>{
  const paid=page('https://quemfazservico.com.br/?utm_source=google&utm_medium=cpc&gclid=abc','https://chatgpt.com/');
  assert.equal(paid.origin.source,'google');assert.equal(paid.origin.medium,'cpc');paid.dom.window.close();
  const fake=page('https://quemfazservico.com.br/','https://chatgpt.com.example.org/');
  assert.equal(fake.origin.source,'direto');fake.dom.window.close();
});
test('origem IA sobrevive à navegação interna para o formulário',()=>{
  const p=page('https://quemfazservico.com.br/servicos/diarista/guarulhos/','https://chatgpt.com/');
  const saved=p.dom.window.sessionStorage.getItem('qf_ai_origin_v1');
  const next=new JSDOM('<!doctype html>',{url:'https://quemfazservico.com.br/?servico=diarista',referrer:'https://quemfazservico.com.br/servicos/diarista/guarulhos/',runScripts:'outside-only'});
  next.window.sessionStorage.setItem('qf_ai_origin_v1',saved);
  next.window.eval(fs.readFileSync(require.resolve('../qf-ai-origin.js'),'utf8'));
  next.window.eval(script);
  assert.equal(next.window.QFClientAcquisition.attribution().source,'chatgpt');
  assert.equal(next.window.QFClientAcquisition.attribution().landing_page,'/servicos/diarista/guarulhos/');
  next.window.close();
  p.dom.window.close();
});
