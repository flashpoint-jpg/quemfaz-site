// V11.76: aba "Painéis" no painel admin e pedido com a localização do bairro (quilometragem certa).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const load = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const admin = load('admin.html'), index = load('index.html'), sql = load('supabase/2026-10-11-paineis-e-local-do-bairro.sql');

test('Painéis é uma opção própria do menu, com relatório para baixar', () => {
  assert.match(admin, /\{ id: 'paineis', label: 'Parados na tela', icon: 'smartphone', route: '\/admin\/paineis' \}/); // V11.95: nome mais claro no menu
  assert.match(admin, /\{ pattern: '\/admin\/paineis', role: 'admin'/);
  assert.match(admin, /rpc\('qf_admin_paineis'\)/);
  assert.match(admin, /'\/admin\/paineis': '<button[^']*data-adm-baixar="paineis"/);
  assert.match(admin, /function admBaixarPaineis\(\)/);
  // atualiza sozinha, sem F5
  assert.match(admin, /querySelector\('\[data-adm-paineis\]'\);\s*if \(pn && pn\.parentNode\) admPaineisCarregar/);
});

test('o relatório só é entregue ao admin e lista os pedidos com vaga livre', () => {
  assert.match(sql, /function public\.qf_admin_paineis\(\)[\s\S]*?if not private\.qf_is_admin\(\) then/);
  assert.match(sql, /revoke all on function private\.qf_paineis_dados\(\) from public, anon, authenticated/);
  assert.match(sql, /where c\.status in \('aberto', 'em_negociacao'\)\s+and v\.ocupadas < v\.limite/);
});

test('o pedido novo guarda a localização do bairro, e cai no centro da cidade só se o bairro não for achado', () => {
  assert.match(index, /async function geocodeBairro\(bairro, cidade, uf\)/);
  assert.match(index, /geocodeBairro: geocodeBairro/);
  assert.match(index, /geoPrecisao = 'bairro'[\s\S]{0,260}geoPrecisao = 'cidade'/);
  assert.match(index, /if \(geoPrecisao\) row\.geo_precisao = geoPrecisao;/);
  // se o banco recusar o campo novo, o pedido é publicado sem ele: o pedido nunca se perde
  assert.match(index, /\/geo_precisao\/i\.test[\s\S]{0,260}delete row\.geo_precisao;/);
});

test('a correção do local pelo painel só troca coordenada aproximada e não aceita ponto longe da cidade', () => {
  assert.match(sql, /function public\.qf_admin_corrigir_local_pedido[\s\S]*?if not private\.qf_is_admin\(\) then/);
  assert.match(sql, /not in \('cidade', 'sem'\)/);
  assert.match(sql, /v_km > 60/);
});
