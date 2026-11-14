const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const Atendimento = require('../qf-atendimento.js');

function acquisition(url, stored, live) {
  const dom = new JSDOM('<!doctype html><body></body>', {url, runScripts:'outside-only'});
  const w = dom.window;
  if(stored) w.sessionStorage.setItem('qf_ads_attribution_v1',JSON.stringify(stored));
  if(live) w.QFMarketingTouch = live;
  w.crypto.randomUUID = () => 'id-teste';
  w.eval(fs.readFileSync(require.resolve('../qf-client-acquisition.js'),'utf8'));
  return {dom,origem:w.QFClientAcquisition.attribution()};
}

test('UTM subsequente da mesma campanha preserva gclid do clique', () => {
  const t=acquisition('https://quemfazservico.com.br/?utm_source=google&utm_campaign=setembro',
    {source:'google',medium:'cpc',gclid:'clique-real',campaign:'setembro'});
  assert.equal(t.origem.gclid,'clique-real');
  assert.equal(t.origem.campaign,'setembro');
  t.dom.window.close();
});

test('novo clique de outra origem não herda gclid anterior', () => {
  const t=acquisition('https://quemfazservico.com.br/?utm_source=instagram&utm_medium=paid_social&fbclid=novo',
    {source:'google',medium:'cpc',gclid:'antigo'});
  assert.equal(t.origem.source,'instagram');
  assert.equal(t.origem.gclid,undefined);
  t.dom.window.close();
});

test('campanha diferente sem clique não herda gclid antigo', () => {
  const t=acquisition('https://quemfazservico.com.br/?utm_source=google&utm_campaign=novembro',
    {source:'google',medium:'cpc',gclid:'outubro',campaign:'outubro'});
  assert.equal(t.origem.gclid,undefined);
  t.dom.window.close();
});

test('captura atual da home prevalece sobre sessão antiga', () => {
  const t=acquisition('https://quemfazservico.com.br/',{source:'google',gclid:'antigo'},
    {source:'google',gclid:'mais-recente',medium:'cpc'});
  assert.equal(t.origem.gclid,'mais-recente');
  t.dom.window.close();
});

test('CEP usa provedor secundário quando o primeiro falha',async()=>{
  const original=global.fetch;
  const previous=global.window;
  const calls=[];
  global.fetch=async url=>{
    calls.push(url);
    if(url.includes('viacep'))throw Error('fora do ar');
    return {ok:true,json:async()=>({city:'Santo André',state:'SP',neighborhood:'Centro'})};
  };
  try{
    const result=await Atendimento.consultarCep('09010-000');
    assert.equal(result.cidade,'Santo André');
    assert.equal(result.uf,'SP');
    assert.equal(calls.length,2);
  }finally{global.fetch=original;global.window=previous;}
});

test('72h não expira negociação nem pedido com desbloqueio',()=>{
  const sql=fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations/20261114012000_preservar_pedidos_em_negociacao_72h.sql'),'utf8');
  assert.match(sql,/c\.status = 'aberto'/);
  assert.match(sql,/not exists\s*\(\s*select 1 from public\.qf_desbloqueios/);
  assert.match(sql,/c\.desfecho is null/);
});
