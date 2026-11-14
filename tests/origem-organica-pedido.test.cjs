const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const script=fs.readFileSync(require.resolve('../qf-client-acquisition.js'),'utf8');

function page(url,referrer,searchSaved){
  const dom=new JSDOM('<!doctype html><body></body>',{url,referrer:referrer||undefined,runScripts:'outside-only'});
  const w=dom.window;
  w.crypto.randomUUID=()=> 'organic-test';
  if(searchSaved)w.sessionStorage.setItem('qf_search_referrer_v1',JSON.stringify(searchSaved));
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
