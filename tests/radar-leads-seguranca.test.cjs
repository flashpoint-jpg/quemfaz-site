const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261018000000_radar_leads_externos.sql');
const adminJs = read('qf-admin-radar.js');
const adminHtml = read('admin.html');
// Ignora comentários SQL ao procurar comandos proibidos.
const sqlCode = migration.replace(/--.*$/gm, '');

test('as quatro tabelas do radar têm RLS ligada, sem acesso de anon/authenticated', () => {
  for (const table of ['qf_leads_externos', 'qf_lead_events', 'qf_lead_sources', 'qf_lead_supressao']) {
    assert.match(sqlCode, new RegExp(`alter table public\\.${table} enable row level security`), table);
  }
  assert.match(sqlCode, /revoke all on public\.qf_leads_externos, public\.qf_lead_events, public\.qf_lead_sources, public\.qf_lead_supressao\s+from anon, authenticated, public/);
  assert.doesNotMatch(sqlCode, /grant\s+(select|insert|update|delete|all)[^;]*on\s+(table\s+)?public\.qf_(leads_externos|lead_events|lead_sources|lead_supressao)/i);
  assert.doesNotMatch(sqlCode, /grant[^;]*\bto\s+(anon|public)\b/i);
});

test('ingestão e leitura de fontes só para service_role; painel só para authenticated com checagem de admin', () => {
  assert.match(sqlCode, /grant execute on function public\.qf_radar_ingest\(jsonb\)[^;]*to service_role;/);
  assert.doesNotMatch(sqlCode, /grant execute on function public\.qf_radar_ingest[^;]*authenticated/);
  const adminFns = [...sqlCode.matchAll(/create or replace function public\.(qf_radar_(?:resumo|listar|eventos|atualizar_status|preparar_convite|marcar_convite_enviado|registrar_manual|excluir|fonte_definir))\(/g)].map(m => m[1]);
  assert.equal(adminFns.length, 9);
  for (const name of adminFns) {
    const body = sqlCode.slice(sqlCode.indexOf(`public.${name}(`)).split(/\$\$;/)[0];
    assert.match(body, /private\.qf_radar_require_admin\(\)/, `${name} sem checagem de administrador`);
  }
});

test('o radar não escreve em pedidos, carteira, desbloqueios, recargas nem notificações e não cria triggers', () => {
  assert.doesNotMatch(sqlCode, /\b(insert\s+into|update|delete\s+from)\s+public\.(qf_chamados|qf_carteiras|qf_movimentacoes_carteira|qf_recargas|qf_desbloqueios|qf_push_\w+|qf_precos_desbloqueio|qf_config|qf_planos\w*)\b/i);
  assert.doesNotMatch(sqlCode, /create\s+(or replace\s+)?trigger/i);
  assert.doesNotMatch(sqlCode, /net\.http_|pg_net|send_push|notify\b/i);
  assert.doesNotMatch(sqlCode, /alter table public\.qf_(chamados|carteiras|desbloqueios|recargas)\b/i);
});

test('o vínculo com o pedido só lê qf_chamados (origem gravada pelo formulário)', () => {
  const sync = sqlCode.slice(sqlCode.indexOf('function private.qf_radar_sync_pedidos'), sqlCode.indexOf('function private.qf_radar_manutencao'));
  assert.match(sync, /join public\.qf_chamados c/);
  assert.match(sync, /marketing_origem->>'source' = 'radar'/);
  assert.doesNotMatch(sync, /(insert\s+into|update|delete\s+from)\s+public\.qf_chamados/i);
});

test('convite é só preparado: o painel não envia mensagens nem abre canais automáticos', () => {
  assert.doesNotMatch(adminJs, /wa\.me|window\.open|sendBeacon|XMLHttpRequest|\bfetch\(/);
  assert.doesNotMatch(adminJs, /\.from\(['"]/, 'o painel não pode ler tabelas direto');
  const rpcs = [...adminJs.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(rpcs.length >= 8);
  for (const name of new Set(rpcs)) assert.match(name, /^qf_radar_/, name);
  assert.doesNotMatch(adminJs, /qf_admin_adicionar_creditos|qf_desbloquear|qf_criar_chamado|insert\(/);
});

test('o painel escapa texto vindo de fontes externas e só abre links https', () => {
  assert.match(adminJs, /function safeLink\(url\)[\s\S]*https:/);
  assert.match(adminJs, /rel="noopener noreferrer"/);
  // texto externo (trecho, serviço, cidade, fonte) sempre passa por esc()
  for (const field of ['l.excerpt', 'l.service', 'l.city', 'l.source']) assert.ok(adminJs.includes(`esc(${field}`), field);
});

test('admin.html carrega classificador e módulo antes da tabela de rotas e expõe a aba', () => {
  const classifier = adminHtml.indexOf('<script src="qf-radar-classifier.js');
  const module_ = adminHtml.indexOf('<script src="qf-admin-radar.js');
  const route = adminHtml.indexOf("pattern: '/admin/radar-leads'");
  assert.ok(classifier > 0 && module_ > classifier && route > module_);
  assert.match(adminHtml, /label: 'Radar de Leads Externos', icon: 'search', route: '\/admin\/radar-leads'/);
  assert.match(adminHtml, /maisItem\('search', 'Radar de Leads Externos', '\/admin\/radar-leads'\)/);
});

test('a tela renderiza os indicadores exigidos e avisa que nada é enviado nem cobrado', () => {
  const sandbox = { window: {}, setTimeout, clearTimeout };
  sandbox.window.Screens = {};
  sandbox.window.PU = { escapeHtml: v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])), toast() {} };
  sandbox.window.icon = () => '';
  vm.runInNewContext(adminJs, sandbox);
  const html = sandbox.window.Screens.adminRadarRender();
  assert.match(html, /Radar de Leads Externos/);
  assert.match(html, /nenhum pedido é criado, nenhum profissional é avisado e nenhum crédito é cobrado/);
  for (const hook of ['data-radar-kpis', 'data-radar-sources', 'data-radar-list', 'data-radar-form', 'data-radar-filters']) assert.ok(html.includes(hook), hook);
});

test('o módulo renderiza todos os indicadores pedidos', () => {
  for (const label of ['Leads encontrados', 'Leads qualificados', 'Convites enviados', 'Clientes confirmados', 'Pedidos publicados',
    'Profissionais que desbloquearam', 'Créditos usados nos desbloqueios', 'Recargas atribuíveis']) {
    assert.ok(adminJs.includes(label), label);
  }
});

test('retenção, exclusão e supressão (LGPD) existem no banco', () => {
  assert.match(sqlCode, /function private\.qf_radar_manutencao/);
  assert.match(sqlCode, /interval '30 days'/);
  assert.match(sqlCode, /interval '180 days'/);
  assert.match(sqlCode, /function public\.qf_radar_excluir/);
  assert.match(sqlCode, /create table if not exists public\.qf_lead_supressao/);
  assert.match(sqlCode, /cron\.schedule\('qf-radar-manutencao'/);
  assert.match(sqlCode, /function private\.qf_radar_redact/);
});

test('fonte só pode ser habilitada com prova de autorização registrada', () => {
  assert.match(sqlCode, /constraint qf_lead_sources_proof_chk check \(\s*enabled = false\s*or \(authorization_note is not null and length\(btrim\(authorization_note\)\) >= 10/);
  assert.match(sqlCode, /enabled boolean not null default false/);
});
