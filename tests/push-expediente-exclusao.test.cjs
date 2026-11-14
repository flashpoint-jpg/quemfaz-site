const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Recuperação de início do expediente preserva a função de entrega', () => {
  const sql = fs.readFileSync('supabase/migrations/20261114052000_recuperar_push_inicio_expediente.sql', 'utf8');
  assert.match(sql, /qf_avisar_inicio_expediente\(boolean\)/);
  assert.match(sql, /\) < 180/);
  assert.match(sql, /\) < 900/);
  assert.doesNotMatch(sql, /insert into public\.qf_push_entregas/i);
});

test('Admin explica integridade financeira antes de tentar apagar dados relacionados', () => {
  const build = fs.readFileSync('scripts/build-client.cjs', 'utf8');
  assert.match(build, /r\.error\.code === '23503'/);
  assert.match(build, /histórico de negociação ou financeiro vinculado/);
  assert.match(build, /Use Editar para cancelar o pedido/);
});
