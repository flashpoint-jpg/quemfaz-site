const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-05-ate-3-profissionais-por-pedido.sql'), 'utf8');

// Scripts continuam com sintaxe válida.
[html, admin].forEach((h, n) => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + n + '-' + i + '.js' })));

// Banco: saem as travas de 1 por pedido e o limite passa a 3.
['uq_qf_desbloqueios_chamado', 'qf_desbloqueios_um_ativo_por_chamado', 'qf_desbloqueios_um_ativo_por_chamado_idx'].forEach((i) => assert.ok(sql.includes('drop index if exists public.' + i + ';'), i));
assert.ok(sql.includes('if v_participantes >= 3 then') && sql.includes("'As 3 vagas deste pedido já foram preenchidas.'"));
assert.ok(sql.includes("'pedido_encerrado', false") && sql.includes("'pedido_encerrado', true"));
assert.ok(sql.includes("desfecho in ('fechado','nao_fechado')"));

// Profissional: as vagas aparecem no cartão da lista, na tela da oportunidade e na confirmação.
assert.ok(html.includes('CallInfo.vagasHtml(req) +'));                       // cartão da lista
assert.ok(html.includes('global.QFCallInfo.vagasHtml(req, true)'));          // tela da oportunidade, antes dos dados
assert.ok(html.includes("message: vagasFrase + (primeiraGratis"));           // confirmação do desbloqueio
assert.ok(html.includes("'As 3 vagas deste pedido já foram preenchidas. Veja os outros serviços disponíveis.'"));
assert.ok(html.includes('limiteParticipantes: row.limite == null ? 3 : Number(row.limite),'));
// Nada mais fala em reserva de um profissional só.
['Quem desbloquear primeiro reserva', 'reservado para um profissional por vez', 'Reserva exclusiva', 'Você reservou este serviço', 'data-qf-continue-search>'].forEach((t) => assert.ok(!html.includes(t), t));

// Conta das vagas.
{
  const a = html.indexOf('    vagas: function (req) {');
  const b = html.indexOf('    vagasHtml: function (req, grande) {');
  assert.ok(a > 0 && b > a);
  const sc = { Number, Math };
  vm.runInNewContext('const CallInfo = {\n' + html.slice(a, b) + '};\nthis.C = CallInfo;', sc);
  assert.deepEqual({ ...sc.C.vagas({}) }, { limite: 3, ocupadas: 0, livres: 3 });
  assert.deepEqual({ ...sc.C.vagas({ participantes: 2, limiteParticipantes: 3 }) }, { limite: 3, ocupadas: 2, livres: 1 });
  assert.deepEqual({ ...sc.C.vagas({ participantes: 9 }) }, { limite: 3, ocupadas: 3, livres: 0 });
  assert.equal(sc.C.vagasTitulo({ participantes: 1 }), '1 de 3 vagas ocupadas');
}

// Cliente: um cartão para cada profissional, sem "Ainda não".
{
  const a = html.indexOf('  function renderConversationCards(rows, req) {');
  const b = html.indexOf('  const conversationCache = new Map();');
  const sc = { esc: (v) => String(v == null ? '' : v), icon: () => '', PU: { initials: () => 'XX' }, Number };
  vm.runInNewContext(html.slice(a, b) + '\nthis.f = renderConversationCards;', sc);
  const req = { id: 'r1' };
  const dois = sc.f([{ profissional_id: 'a', profissional_nome: 'Ana' }, { profissional_id: 'b', profissional_nome: 'Beto' }], req);
  assert.ok(dois.includes('2 profissionais desbloquearam seu pedido') && dois.includes('2 de 3'));
  assert.equal((dois.match(/data-qf-choose-prof=/g) || []).length, 2);
  assert.ok(dois.includes('/cliente/chat/r1/a') && dois.includes('/cliente/chat/r1/b'));
  const um = sc.f([{ profissional_id: 'a', profissional_nome: 'Ana' }], req);
  assert.ok(um.includes('Um profissional desbloqueou seu pedido') && (um.match(/data-qf-choose-prof=/g) || []).length === 1);
  const escolhido = sc.f([{ profissional_id: 'a', profissional_nome: 'Ana', selecionado: true }, { profissional_id: 'b', profissional_nome: 'Beto' }], req);
  assert.ok(escolhido.includes('Serviço confirmado') && !escolhido.includes('data-qf-choose-prof=') && !escolhido.includes('Beto'));
  assert.ok(sc.f([], req).includes('aguardando um profissional desbloquear'));
}

// Painel: lista de quem desbloqueou e contas por desbloqueio.
assert.ok(admin.includes('desbloqueios: temDesb ? (desbs[c.id] || []) : null,') && admin.includes("Quem desbloqueou' + (desb.length ?"));
{
  const a = admin.indexOf('  function fechamentoStats(dias) {');
  const b = admin.indexOf('  function fechKpi(');
  const S = { AGUARDANDO: 'aguardando_orcamento', CONCLUIDO: 'servico_concluido', CANCELADO: 'cancelado' };
  const hoje = new Date().toISOString();
  const reqs = [
    // 3 profissionais no mesmo pedido: um desistiu, dois ainda em conversa
    { status: S.AGUARDANDO, criadoEm: hoje, desbloqueios: [{ profissionalId: 'p1', ativo: true, desfecho: 'nao_fechado' }, { profissionalId: 'p2', ativo: true, desfecho: null }, { profissionalId: 'p3', ativo: true, desfecho: null }] },
    // 2 no mesmo pedido: p2 fechou
    { status: S.CONCLUIDO, criadoEm: hoje, desfecho: 'fechado', desbloqueios: [{ profissionalId: 'p1', ativo: true, desfecho: null }, { profissionalId: 'p2', ativo: true, desfecho: 'fechado' }] },
    // sem desbloqueio
    { status: 'buscando', criadoEm: hoje, desbloqueios: [] },
    // desbloqueio inativo não conta
    { status: 'buscando', criadoEm: hoje, desbloqueios: [{ profissionalId: 'p9', ativo: false, desfecho: null }] },
  ];
  const sc = { DB: { allRequests: () => reqs }, ST_DESBLOQUEADO: [S.AGUARDANDO], ST_CONCLUIDO: [S.CONCLUIDO], Date, Math, Object };
  vm.runInNewContext(admin.slice(a, b) + '\nthis.f = fechamentoStats;', sc);
  const m = sc.f(30);
  assert.deepEqual([m.pedidos, m.desbloqueados, m.desbloqueios, m.fechados, m.aguardando], [4, 2, 5, 1, 1]);
  const pp = Object.fromEntries(m.porProf.map((x) => [x.id, [x.desbloqueou, x.fechou, x.aguardando]]));
  assert.deepEqual(pp, { p1: [2, 0, 0], p2: [2, 1, 1], p3: [1, 0, 1] });
}

console.log('ate-3-por-pedido: ok');
