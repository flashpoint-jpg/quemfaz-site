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

// Outubro/2026: "Sem pressa", "Com pressa" e "Agendado" saíram das telas. O módulo continua montando os dados antigos,
// mas nada do prazo antigo é mostrado para cliente nem profissional (histórico fica só no banco).
[
  { prazo: 'hoje', prazoDia: '2026-10-05', periodo: 'tarde' },
  { prazo: 'amanha', prazoDia: '2026-10-06' },
  { prazo: 'data', prazoDia: '2026-10-10', periodo: 'manha' },
  { prazo: 'semana', prazoDia: '2026-10-11' },
  { prazo: 'sem_pressa' },
  {}
].forEach((r) => {
  assert.equal(P.info(r, now), null);
  assert.equal(P.seloHtml(P.info(r, now)), '');
  assert.equal(P.linhaHtml(P.info(r, now)), '');
});

// Tela do cliente: o campo "Pra quando você precisa?" não existe mais; a urgência é Normal ou Urgente.
assert.ok(!html.includes('id="qf-prazo-label"'));
assert.ok(!html.includes("opt('sem_pressa', 'Sem pressa', true)"));
assert.ok(!html.includes('prazoFieldHtml'));
assert.ok(!html.includes('bindPrazoField'));
assert.ok(html.includes('Qual a urgência do seu serviço?'));
// Pedido novo não grava mais o prazo antigo; só a urgência grátis.
assert.ok(!html.includes("if (comPrazo) { row.prazo = data.prazo;"));
assert.ok(html.includes("if (comUrgencia) row.urgencia = data.urgencia;"));

// O prazo chega pela consulta à parte; se ela falhar, a lista de pedidos segue igual.
{
  const i = html.indexOf('  async function attachUrgencias(rows) {');
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
    const chamadas = [];
    const ok = await run({ rpc: async (n, args) => {
      chamadas.push([n, args.p_ids.slice()]);
      if (n === 'qf_chamados_urgencias') return { data: [{ id: 'a', urgencia: 'urgente' }], error: null };
      return { data: [{ id: 'a', prazo: 'amanha', prazo_dia: '2026-10-06', periodo: 'tarde' }], error: null };
    } });
    assert.deepEqual(chamadas, [['qf_chamados_urgencias', ['a', 'b', 'c']], ['qf_chamados_prazos', ['a', 'b']]]);   // só pergunta o que ainda não tem
    assert.deepEqual({ ...ok[0] }, { id: 'a', urgencia: 'urgente', prazo: 'amanha', prazo_dia: '2026-10-06', periodo: 'tarde' });
    assert.deepEqual({ ...ok[1] }, { id: 'b' });
    const falha = await run({ rpc: async () => ({ data: null, error: { message: 'função não existe' } }) });
    assert.deepEqual({ ...falha[0] }, { id: 'a' });   // se a consulta falhar, o pedido aparece igual
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
