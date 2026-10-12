const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const load=p=>fs.readFileSync(path.join(root,p),'utf8');

test('carteirinha aparece somente no painel do profissional',()=>{
  const js=load('qf-carteirinha.js');
  assert.match(js,/sess|sessionId/);
  assert.match(js,/profissional-home/);
  assert.match(js,/qf_minha_carteirinha/);
  assert.match(js,/token=/);
  assert.doesNotMatch(js,/p_profissional_id:id/);
  new vm.Script(js);
  assert.match(load('index.html'),/qf-carteirinha\.js\?v=11\.76\.0/);
});

test('carteirinha imprime QR pessoal sem profissão ou pontuação',()=>{
  const html=load('carteirinha.html');
  assert.match(html,/qf_carteirinha_publica/);
  assert.match(html,/QRCode/);
  assert.match(html,/avaliar\.html\?token=/);
  assert.match(html,/@media print/);
  const main=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(main);
  new vm.Script(main[1]);
  assert.doesNotMatch(html,/<(?:div|p)[^>]*>Profissão</i);
  assert.doesNotMatch(html,/>Pontuação</i);
});

test('cliente avalia sem conta, com estrelas e comentário opcional',()=>{
  const html=load('avaliar.html');
  assert.match(html,/qf_avaliar_carteirinha/);
  assert.match(html,/p_dispositivo:visitante\(\)/);
  assert.match(html,/p_nota:nota/);
  assert.match(html,/data-nota="5"/);
  assert.match(html,/Comentário \(opcional\)/);
  assert.match(html,/ja_avaliou/);
  const script=html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  new vm.Script(script[1]);
});
