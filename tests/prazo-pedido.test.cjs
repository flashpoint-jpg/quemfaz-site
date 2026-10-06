// V11.29 — "Pra quando você precisa?" no pedido rápido e o prazo do lado do profissional.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-05-prazo-do-pedido.sql'), 'utf8');

// Scripts continuam com sintaxe válida e a versão do app bate com a do service worker.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));
const appV = /const APP_VERSION = '([^']+)'/.exec(html)[1];
const swV = /const SW_VERSION = '([^']+)'/.exec(sw)[1];
assert.equal(appV, swV);

// Módulo QFPrazo, rodado isolado.
const a = html.indexOf('/* QuemFaz V11.29 — prazo do pedido');
const b = html.indexOf('/* QuemFaz — dados do Supabase');
assert.ok(a > 0 && b > a);
const win = { PU: { escapeHtml: (v) => String(v).replace(/</g, '&lt;') }, icon: () => '<svg></svg>' };
vm.runInNewContext(html.slice(html.indexOf('(function (global) {', a), b), { window: win, Date, Math, Number, String, Array });
const P = win.QFPrazo;
assert.ok(P);

// Segunda-feira, 05/10/2026, 08:14 (horário do aparelho).
const now = new Date(2026, 9, 5, 8, 14, 0).getTime();

// O que vai para o banco: sempre o DIA real, nunca a palavra.
assert.deepEqual({ ...P.montar('sem_pressa', 'tarde', '', now) }, { ok: true, prazo: 'sem_pressa', prazoDia: null, periodo: null });
assert.deepEqual({ ...P.montar('hoje', 'tarde', '', now) }, { ok: true, prazo: 'hoje', prazoDia: '2026-10-05', periodo: 'tarde' });
assert.deepEqual({ ...P.montar('amanha', '', '', now) }, { ok: true, prazo: 'amanha', prazoDia: '2026-10-06', periodo: null });
assert.deepEqual({ ...P.montar('semana', 'noite', '', now) }, { ok: true, prazo: 'semana', prazoDia: '2026-10-11', periodo: null });
assert.deepEqual({ ...P.montar('data', 'manha', '2026-10-10', now) }, { ok: true, prazo: 'data', prazoDia: '2026-10-10', periodo: 'manha' });
assert.equal(P.montar('data', '', '', now).ok, false);                 // sem escolher o dia
assert.equal(P.montar('data', '', '2026-10-04', now).ok, false);       // dia que já passou
assert.equal(P.montar('data', '', '2026-02-31', now).ok, false);       // dia que não existe
assert.equal(P.montar('qualquer coisa', 'xx', '', now).prazo, 'sem_pressa');
// Virada do mês e do ano.
assert.equal(P.montar('amanha', '', '', new Date(2026, 11, 31, 23, 50).getTime()).prazoDia, '2027-01-01');
assert.equal(P.montar('semana', '', '', new Date(2026, 9, 28, 10, 0).getTime()).prazoDia, '2026-11-03');

// Períodos de hoje que já passaram.
assert.deepEqual({ ...P.periodosPassados(new Date(2026, 9, 5, 8, 0).getTime()) }, { manha: false, tarde: false, noite: false });
assert.deepEqual({ ...P.periodosPassados(new Date(2026, 9, 5, 15, 0).getTime()) }, { manha: true, tarde: false, noite: false });
assert.deepEqual({ ...P.periodosPassados(new Date(2026, 9, 5, 19, 0).getTime()) }, { manha: true, tarde: true, noite: false });

// Como o profissional vê.
const ver = (r, quando) => { const i = P.info(r, quando == null ? now : quando); return i && [i.tom, i.urgente, i.selo, i.texto]; };
assert.deepEqual(ver({ prazo: 'hoje', prazoDia: '2026-10-05', periodo: 'tarde' }), ['hoje', true, 'PRA HOJE', 'Hoje, à tarde']);
assert.deepEqual(ver({ prazo: 'amanha', prazoDia: '2026-10-06' }), ['amanha', false, 'PRA AMANHÃ', 'Amanhã (ter, 06/10)']);
assert.deepEqual(ver({ prazo: 'data', prazoDia: '2026-10-10', periodo: 'manha' }), ['data', false, 'DIA 10/10', 'Sáb, 10/10, de manhã']);
assert.deepEqual(ver({ prazo: 'semana', prazoDia: '2026-10-11' }), ['data', false, 'ATÉ 11/10', 'Até dom, 11/10']);
assert.deepEqual(ver({ prazo: 'sem_pressa' }), ['sem', false, 'SEM PRESSA', 'Sem pressa']);
assert.equal(P.info({}, now), null);                                    // pedido antigo
assert.equal(P.info({ prazo: 'hoje', prazoDia: null }, now), null);     // dado quebrado não inventa prazo
// O ponto principal: pedido feito para "hoje" não continua "hoje" no dia seguinte.
const amanha = new Date(2026, 9, 6, 9, 0).getTime();
assert.deepEqual(ver({ prazo: 'hoje', prazoDia: '2026-10-05' }, amanha), ['atrasado', false, 'ERA PRA 05/10', 'Era pra seg, 05/10']);
// E o pedido para "amanhã" vira urgente quando o dia chega.
assert.deepEqual(ver({ prazo: 'amanha', prazoDia: '2026-10-06' }, amanha), ['hoje', true, 'PRA HOJE', 'Hoje']);
assert.deepEqual(ver({ prazo: 'semana', prazoDia: '2026-10-06' }, amanha), ['hoje', true, 'ATÉ HOJE', 'Até hoje']);
assert.deepEqual(ver({ prazo: 'semana', prazoDia: '2026-10-05' }, amanha), ['atrasado', false, 'ERA ATÉ 05/10', 'Era até seg, 05/10']);
// A data com hora (formato que o banco pode devolver) também é lida.
assert.equal(P.info({ prazo: 'data', prazoDia: '2026-10-10T00:00:00+00:00' }, now).selo, 'DIA 10/10');

// Urgência: pedido antigo segue a regra de antes (sem data = urgente); "sem pressa" não é urgente.
assert.equal(P.urgente({}, now), true);
assert.equal(P.urgente({ dataPreferida: new Date(now + 3 * 86400000).toISOString() }, now), false);
assert.equal(P.urgente({ prazo: 'sem_pressa' }, now), false);
assert.equal(P.urgente({ prazo: 'hoje', prazoDia: '2026-10-05' }, now), true);

// Ordem da lista: urgentes, depois com dia (o mais próximo antes), por último sem pressa.
const lista = [
  { id: 'sem', prazo: 'sem_pressa' },
  { id: 'sab', prazo: 'data', prazoDia: '2026-10-10' },
  { id: 'amanha', prazo: 'amanha', prazoDia: '2026-10-06' },
  { id: 'hoje', prazo: 'hoje', prazoDia: '2026-10-05' },
  { id: 'ontem', prazo: 'hoje', prazoDia: '2026-10-04' },
  { id: 'antigo' }
];
const ordem = lista.slice().sort((x, y) => P.comparar(x, y, now)).map((r) => r.id);
assert.deepEqual(ordem.slice(0, 2).sort(), ['antigo', 'hoje']);
assert.deepEqual(ordem.slice(2), ['ontem', 'amanha', 'sab', 'sem']);

// Selo: só "pra hoje" usa o vermelho piscando; texto do cliente nunca vira HTML.
assert.ok(P.seloHtml(P.info({ prazo: 'hoje', prazoDia: '2026-10-05' }, now)).includes('qf-urgent-badge'));
assert.ok(P.seloHtml(P.info({ prazo: 'sem_pressa' }, now)).includes('qf-prazo-selo--sem'));
assert.equal(P.seloHtml(null), '');
assert.ok(P.linhaHtml(P.info({ prazo: 'amanha', prazoDia: '2026-10-06', periodo: 'noite' }, now)).includes('<strong>Quando:</strong> Amanhã (ter, 06/10), à noite'));

// Tela do cliente: o campo está no pedido rápido, com "Sem pressa" já marcado.
assert.ok(html.includes("'<span class=\"field__label\" id=\"qf-prazo-label\">Pra quando você precisa?</span>'"));
assert.ok(html.includes("opt('hoje', 'Hoje') + opt('amanha', 'Amanhã') + opt('semana', 'Esta semana') + opt('data', 'Escolher data') + opt('sem_pressa', 'Sem pressa', true)"));
assert.ok(html.includes("per('manha', 'Manhã') + per('tarde', 'Tarde') + per('noite', 'Noite')"));
assert.ok(html.includes('          prazoFieldHtml() +'));
assert.ok(html.includes('      bindPrazoField(form);'));
assert.ok(html.includes('}, prazoDados))'));
// O pedido nunca se perde por causa do prazo: se o banco recusar os campos, publica sem eles.
assert.ok(html.includes("delete row.prazo; delete row.prazo_dia; delete row.periodo;"));
// O prazo não mexe na data que segura o aviso (data_preferida).
assert.ok(html.includes("if (comPrazo) { row.prazo = data.prazo; row.prazo_dia = data.prazoDia || null; row.periodo = data.periodo || null; }"));

// Profissional: cartão, ordem das duas listas, tela do pedido, tela cheia e aviso.
assert.ok(html.includes("(prazoInfo ? global.QFPrazo.seloHtml(prazoInfo) : (urgente ? '<span class=\"qf-urgent-badge\">URGENTE</span>' : ''))"));
assert.equal((html.match(/global\.QFPrazo\.comparar\(a,b\)/g) || []).length, 2);
assert.ok(html.includes("'Para quando você pediu' : 'Quando o cliente precisa'"));
assert.ok(html.includes('qf-call-overlay__prazo'));
assert.ok(html.includes("[detail, pz ? pz.texto : '', CI.kmTxt(r), CI.tempoTxt(r), CI.precoTxt(r, currentUser())]"));

// O prazo chega pela consulta à parte; se ela falhar, a lista de pedidos segue igual.
{
  const i = html.indexOf('  async function attachPrazos(rows) {');
  const j = html.indexOf('  function requestFromCloud(row, professionalId) {');
  assert.ok(i > 0 && j > i);
  const run = async (client) => {
    const sc = { client, console: { warn() {} } };
    vm.runInNewContext(html.slice(i, j) + '\nthis.f = attachPrazos;', sc);
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c', prazo: 'hoje', prazo_dia: '2026-10-05' }];
    await sc.f(rows);
    return rows;
  };
  (async () => {
    let pedido = null;
    const ok = await run({ rpc: async (n, args) => { pedido = [n, args.p_ids.slice()]; return { data: [{ id: 'a', prazo: 'amanha', prazo_dia: '2026-10-06', periodo: 'tarde' }], error: null }; } });
    assert.deepEqual(pedido, ['qf_chamados_prazos', ['a', 'b']]);          // só pergunta o que ainda não tem
    assert.deepEqual({ ...ok[0] }, { id: 'a', prazo: 'amanha', prazo_dia: '2026-10-06', periodo: 'tarde' });
    assert.deepEqual({ ...ok[1] }, { id: 'b' });
    const falha = await run({ rpc: async () => ({ data: null, error: { message: 'função não existe' } }) });
    assert.deepEqual({ ...falha[0] }, { id: 'a' });
    const quebra = await run({ rpc: async () => { throw new Error('sem internet'); } });
    assert.deepEqual({ ...quebra[1] }, { id: 'b' });
    console.log('prazo-pedido: ok');
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Banco.
assert.ok(sql.includes('add column if not exists prazo text,') && sql.includes('add column if not exists prazo_dia date,') && sql.includes('add column if not exists periodo text;'));
assert.ok(sql.includes('create or replace function public.qf_chamados_prazos(p_ids uuid[])'));
assert.ok(sql.includes('grant execute on function public.qf_chamados_prazos(uuid[]) to authenticated;'));
assert.ok(sql.includes('private.qf_prazo_texto(ch.prazo, ch.prazo_dia, ch.periodo),'));
// O gatilho arruma e nunca recusa o pedido.
assert.ok(sql.includes('exception when others then') && sql.includes("raise warning 'QuemFaz normalizar prazo: %', sqlerrm;"));
// Nada aqui muda quando o aviso sai: as regras de data_preferida não são tocadas.
['qf_disparar_push_novo_chamado', 'qf_cascata_tick', 'qf_alertar_chamados_parados', 'qf_alertar_programados_24h', 'qf_listar_chamados_disponiveis', 'qf_portfolio_servicos'].forEach((f) => assert.ok(!sql.includes('function public.' + f) && !sql.includes('function private.' + f), f));
