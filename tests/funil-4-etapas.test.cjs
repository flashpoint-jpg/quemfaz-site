const assert = require('node:assert/strict');
const fs = require('node:fs');
const {test} = require('node:test');
const html = fs.readFileSync('index.html', 'utf8');
const acquisition = fs.readFileSync('qf-client-acquisition.js','utf8');
const dashboard = fs.readFileSync('qf-admin-acquisition.js','utf8');
const migration = fs.readFileSync('supabase/2026-10-11-funil-quatro-etapas.sql','utf8');

test('localização confirma estado antes de avançar',()=>{
  const start=html.indexOf('async function avancarSub()');
  const end=html.indexOf('form.__qfAvancarSub = avancarSub',start);
  const block=html.slice(start,end);
  assert.ok(start>0 && end>start);
  assert.match(block,/await sugestoesPedido\.resolveRegion/);
  assert.match(block,/if \(uf && !String\(uf\.value/);
  assert.match(block,/form\.__qfMostrarUf/);
  assert.ok(block.indexOf('Confirme o estado (UF)')<block.indexOf("irSub('b')"));
});
test('quatro etapas enviam eventos aceitos pelo banco e exibidos no painel',()=>{
  for(const event of ['step_service_completed','step_location_view','step_location_completed',
                      'step_options_view','step_options_completed','step_contact_view']){
    assert.ok(html.includes("'"+event+"'"),event+' ausente na tela');
    assert.ok(dashboard.includes(event+':'),event+' ausente no painel');
    assert.ok(migration.includes("'"+event+"'"),event+' ausente no banco');
  }
});
test('anúncios de serviços novos usam categoria existente e preservam home',()=>{
  for(const [key,cat] of Object.entries({
    chaveiro:'cat_chaveiro',antenista:'cat_antenista',faxina_pos_obra:'cat_faxina_pos_obra',
    limpeza_pos_obra:'cat_faxina_pos_obra',montagem:'cat_montador'
  })){
    assert.ok(acquisition.includes(key+": '"+cat+"'"),key);
    assert.ok(html.includes("id: '"+cat+"'"),cat);
  }
  assert.match(acquisition,/data-landing-service-search/);
  assert.match(acquisition,/sessionStorage\.setItem\('qf_pending_category', cat\)/);
});
