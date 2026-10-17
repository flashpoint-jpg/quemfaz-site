const test = require('node:test');
const assert = require('node:assert/strict');
const { main, dueForRun } = require('../scripts/radar-leads-run.cjs');

// Tudo FICTÍCIO: banco e rede são simulados, nada real é lido ou gravado.
const ENV = { SUPABASE_URL: 'https://x.invalid', SUPABASE_SERVICE_ROLE_KEY: 'teste' };
const feed = items => `<rss><channel>${items.map((i, n) => `<item><title>${i}</title><link>https://forum.teste.invalid/t/${n}</link></item>`).join('')}</channel></rss>`;
const source = (over = {}) => ({ id: 'forum_teste', kind: 'rss', allowed_host: 'forum.teste.invalid', rate_limit_minutes: 180,
  last_run_at: null, config: { feed_url: 'https://forum.teste.invalid/feed.xml' }, ...over });
function harness(sources, xml, status = 200) {
  const calls = [];
  const rpc = async (name, args) => { calls.push([name, args]); return name === 'qf_radar_fontes_ativas' ? sources : name === 'qf_radar_ingest' ? { novos: args.p_items.length } : null; };
  const fetchImpl = async () => ({ ok: status === 200, status, headers: { get: () => null }, text: async () => xml });
  return { calls, deps: { rpc, fetchImpl } };
}
const log = console.log; const quiet = fn => async (...a) => { console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };

test('sem credenciais do servidor não coleta nada', quiet(async () => {
  const r = await main([], {}, {});
  assert.equal(r.executado, false);
}));

test('sem fonte habilitada não coleta nada', quiet(async () => {
  const h = harness([], '');
  const r = await main([], ENV, h.deps);
  assert.deepEqual(r.fontes, []);
  assert.deepEqual(h.calls.map(c => c[0]), ['qf_radar_fontes_ativas']);
}));

test('grava só pedidos reais; ofertas e irrelevantes não são enviadas', quiet(async () => {
  const h = harness([source()], feed(['Preciso de pintor em Santo André', 'Sou pintor, ofereço serviços em Mauá', 'Bom dia pessoal', 'Procuro encanador em Diadema']));
  const r = await main([], ENV, h.deps);
  const ingest = h.calls.find(c => c[0] === 'qf_radar_ingest');
  assert.equal(ingest[1].p_items.length, 2);
  assert.deepEqual(ingest[1].p_items.map(i => i.service).sort(), ['encanador', 'pintor']);
  assert.ok(ingest[1].p_items.every(i => i.intent === 'procura_profissional' && i.source === 'forum_teste'));
  assert.equal(r.fontes[0].ofertas_descartadas, 1);
  assert.equal(r.fontes[0].status, 'ok');
  assert.ok(h.calls.some(c => c[0] === 'qf_radar_fonte_resultado'));
}));

test('--dry-run classifica mas não grava nem atualiza a fonte', quiet(async () => {
  const h = harness([source()], feed(['Preciso de pintor em Santo André']));
  const r = await main(['--dry-run'], ENV, h.deps);
  assert.equal(r.fontes[0].candidatos, 1);
  assert.deepEqual(h.calls.map(c => c[0]), ['qf_radar_fontes_ativas']);
}));

test('respeita o intervalo mínimo da fonte', quiet(async () => {
  const recent = new Date(Date.now() - 10 * 60000).toISOString();
  const h = harness([source({ last_run_at: recent })], feed(['Preciso de pintor em Santo André']));
  const r = await main([], ENV, h.deps);
  assert.equal(r.fontes[0].status, 'aguardando_intervalo');
  assert.deepEqual(h.calls.map(c => c[0]), ['qf_radar_fontes_ativas']);
  assert.equal(dueForRun(source({ last_run_at: recent }), Date.now(), true), true);
}));

test('fonte bloqueada é registrada como bloqueada e nada é gravado', quiet(async () => {
  const h = harness([source()], '', 403);
  const r = await main([], ENV, h.deps);
  assert.equal(r.fontes[0].status, 'bloqueada');
  assert.equal(h.calls.some(c => c[0] === 'qf_radar_ingest'), false);
  const result = h.calls.find(c => c[0] === 'qf_radar_fonte_resultado');
  assert.equal(result[1].p_status, 'bloqueada');
}));

test('itens de outro domínio que o aprovado são descartados antes da gravação', quiet(async () => {
  const xml = `<rss><channel><item><title>Preciso de pintor em Mauá</title><link>https://outro.teste.invalid/t/1</link></item></channel></rss>`;
  const h = harness([source()], xml);
  const r = await main([], ENV, h.deps);
  assert.equal(r.fontes[0].candidatos, 0);
  assert.equal(r.fontes[0].rejeitados.fonte_nao_aprovada, 1);
}));
