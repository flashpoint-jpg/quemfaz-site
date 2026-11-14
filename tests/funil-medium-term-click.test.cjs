const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function run(url) {
  const dom = new JSDOM('<!doctype html><body></body>', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const rows = [];
  w.crypto.randomUUID = () => 'id-' + rows.length;
  w.QFCloud = { enabled: true, client: { from: () => ({ insert: (row) => { rows.push(row); return Promise.resolve({ error: null }); } }) } };
  w.eval(fs.readFileSync(require.resolve('../qf-client-acquisition.js'), 'utf8'));
  w.QFClientAcquisition.track('form_view', {}, true);
  return { dom, rows };
}

test('clique do Google Ads grava meio, termo e tipo de clique no funil', async () => {
  const t = run('https://quemfazservico.com.br/?utm_source=google&utm_medium=cpc&utm_campaign=24443887906&utm_term=montador%20de%20moveis&gclid=ABC123');
  await new Promise((r) => setTimeout(r, 10));
  const row = t.rows[0];
  assert.equal(row.source, 'google');
  assert.equal(row.medium, 'cpc');
  assert.equal(row.campaign, '24443887906');
  assert.equal(row.term, 'montador de moveis');
  assert.equal(row.click_type, 'gclid');
  assert.equal(JSON.stringify(row).includes('ABC123'), false, 'o identificador do clique não pode ir para o funil');
  t.dom.window.close();
});

test('iPhone só com gbraid vira google/cpc com click_type gbraid', async () => {
  const t = run('https://quemfazservico.com.br/?gbraid=XYZ');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.rows[0].source, 'google');
  assert.equal(t.rows[0].medium, 'cpc');
  assert.equal(t.rows[0].click_type, 'gbraid');
  t.dom.window.close();
});

test('acesso sem parâmetros não inventa meio, termo nem clique', async () => {
  const t = run('https://quemfazservico.com.br/');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.rows[0].source, 'direto');
  assert.equal(t.rows[0].medium, null);
  assert.equal(t.rows[0].term, null);
  assert.equal(t.rows[0].click_type, null);
  t.dom.window.close();
});

test('migração libera INSERT das colunas novas e limita click_type', () => {
  const sql = fs.readFileSync(require.resolve('../supabase/migrations/20261114103000_funil_medium_term_click_type.sql'), 'utf8');
  assert.match(sql, /grant insert \(medium, term, click_type\) on public\.qf_client_funnel to anon, authenticated/);
  assert.match(sql, /click_type in \('gclid', 'gbraid', 'wbraid', 'fbclid', 'msclkid', 'ttclid'\)/);
});
