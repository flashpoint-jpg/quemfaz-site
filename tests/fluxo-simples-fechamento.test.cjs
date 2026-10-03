const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-03-fluxo-simples-fechamento.sql'), 'utf8');

// Scripts continuam com sintaxe válida.
[html, admin].forEach((h, n) => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + n + '-' + i + '.js' })));

// Etapas simples: nada de "orçamento aprovado" nem "profissional conectado" nos rótulos.
[html, admin].forEach((h) => {
  assert.ok(h.includes("aguardando_orcamento: 'Desbloqueado',"));
  assert.ok(h.includes("servico_concluido: 'Concluído',"));
  assert.ok(!h.includes("aguardando_orcamento: 'Profissional conectado',\n    orcamento_enviado"));
  assert.ok(!h.includes("aprovado: 'Orçamento aprovado',\n    em_andamento"));
});

// Profissional: sai orçamento/iniciar/concluir, entram "Fechei o serviço" e "Não fechei".
assert.ok(html.includes('data-action="fechei-servico"'));
assert.ok(html.includes('data-action="nao-fechei-servico"'));
assert.ok(!html.includes(' Criar orçamento</button></div>'));
assert.ok(!html.includes(' Enviar proposta (opcional)</button>\' +'));
assert.ok(!html.includes('data-action="iniciar-servico"'));
assert.ok(!html.includes('data-action="finalizar-servico"'));
assert.ok(html.includes("client.rpc('qf_profissional_fechar_chamado', { p_chamado_id: chamadoId, p_fechou: !!fechou })"));

// Linha do tempo do cliente com 4 etapas.
assert.ok(html.includes('const order = [STATUS.BUSCANDO, STATUS.AGUARDANDO_ORCAMENTO, STATUS.SERVICO_CONCLUIDO, STATUS.FINALIZADO];'));

// Painel: abas novas, quadro de fechamento e desfecho vindo do banco.
assert.ok(admin.includes("label: 'Abertos'") && admin.includes("label: 'Desbloqueados'"));
assert.ok(admin.includes('id="admin-fechamento"') && admin.includes('Está dando certo?'));
assert.ok(admin.includes('desfecho: c.desfecho || null'));

// Conta do quadro de fechamento.
const a = admin.indexOf('  function fechamentoStats(dias) {');
const b = admin.indexOf('  function fechKpi(');
assert.ok(a > 0 && b > a);
const S = { AGUARDANDO_ORCAMENTO: 'aguardando_orcamento', SERVICO_CONCLUIDO: 'servico_concluido', CANCELADO: 'cancelado', BUSCANDO: 'buscando' };
const hoje = new Date().toISOString();
const antigo = new Date(Date.now() - 40 * 86400000).toISOString();
const reqs = [
  { status: S.BUSCANDO, criadoEm: hoje },
  { status: S.AGUARDANDO_ORCAMENTO, profissionalId: 'p1', criadoEm: hoje },
  { status: S.SERVICO_CONCLUIDO, profissionalId: 'p1', desfecho: 'fechado', criadoEm: hoje },
  { status: S.CANCELADO, profissionalId: 'p2', desfecho: 'nao_fechado', criadoEm: hoje },
  { status: S.CANCELADO, profissionalId: 'p2', desfecho: 'sem_retorno', criadoEm: hoje },
  { status: S.CANCELADO, profissionalId: 'p2', criadoEm: hoje },
  { status: S.SERVICO_CONCLUIDO, profissionalId: 'p3', criadoEm: antigo }
];
const scope = { DB: { allRequests: () => reqs }, ST_DESBLOQUEADO: [S.AGUARDANDO_ORCAMENTO], ST_CONCLUIDO: [S.SERVICO_CONCLUIDO], Date, Math, Object };
vm.runInNewContext(admin.slice(a, b) + '\nthis.f = fechamentoStats;', scope);
const m = scope.f(30);
assert.deepEqual([m.pedidos, m.desbloqueados, m.fechados, m.naoFechados, m.semRetorno, m.aguardando, m.outros, m.taxa], [6, 5, 1, 1, 1, 1, 1, 20]);
assert.equal(scope.f(0).fechados, 2);
assert.equal(m.porProf[0].id, 'p2');

// Banco: desfecho, permissão, 7 dias e expiração de 3 dias só para pedido aberto.
assert.match(sql, /check \(desfecho is null or desfecho in \('fechado', 'nao_fechado', 'sem_retorno'\)\)/);
assert.match(sql, /d\.profissional_id = v_prof\s+and coalesce\(d\.ativo, true\)/);
assert.match(sql, /set status = 'concluido', desfecho = 'fechado'/);
assert.match(sql, /set status = 'cancelado', desfecho = 'nao_fechado'/);
assert.match(sql, /d\.criado_em > now\(\) - interval '7 days'/);
assert.match(sql, /cron\.schedule\('qf-fechar-sem-retorno'/);
assert.match(sql, /where c\.status = 'aberto'\s+and c\.criado_em < now\(\) - interval '3 days'/);
assert.match(sql, /revoke execute on function public\.qf_profissional_fechar_chamado\(uuid, boolean\) from public, anon/);
console.log('fluxo-simples-fechamento: ok');
assert.match(sql, /p_tipo = 'cliente' and c\.cliente_id = p_uid and c\.desfecho is distinct from 'fechado'/);
assert.ok(html.includes("global.navigate(fechou ? '/profissional/pedido/' + params.id : '/profissional/servicos', true);"));
console.log('fluxo-simples-fechamento: banco real ok');
