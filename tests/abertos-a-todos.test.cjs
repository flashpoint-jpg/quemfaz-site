// V11.32 — pedidos "Abertos a todos" e faixa de movimento na tela do profissional.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-06-pedidos-abertos-a-todos.sql'), 'utf8');

// Scripts continuam com sintaxe válida e a versão do app bate com a do service worker.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));
assert.equal(/const APP_VERSION = '([^']+)'/.exec(html)[1], /const SW_VERSION = '([^']+)'/.exec(sw)[1]);

// Banco: libera depois da última etapa da cascata sem desbloqueio, ou direto sem profissional da categoria.
assert.ok(sql.includes("then 'sem_profissional'") && sql.includes("then 'sem_desbloqueio'"));
assert.ok(sql.includes('k.etapa >= 3'));
assert.ok(sql.includes('private.qf_chamado_aberto_todos(c.id) is not null'));
// Nenhum aviso sonoro novo: o script não dispara push.
assert.ok(!sql.includes('qf_push_interno'));
// As funções novas não ficam abertas para visitante.
assert.ok(sql.includes('revoke all on function public.qf_pedidos_abertos_todos() from public, anon;'));
assert.ok(sql.includes('revoke all on function public.qf_movimento_pedidos() from public, anon;'));

// App: o pedido aberto a todos passa pelo filtro de categoria, na lista e na tela da oportunidade.
assert.ok(html.includes('(prof.categorias.indexOf(r.categoriaId) !== -1 || !!r.abertoTodos) &&'));
assert.ok(html.includes('(user.categorias.indexOf(req.categoriaId) !== -1 || !!req.abertoTodos) &&'));
// Seção própria nas duas telas, com o aviso do crédito e sem o destaque de "Novo chamado".
assert.equal(html.split('global.QFAbertos.secaoHtml(abertos,user)').length - 1, 2);
assert.ok(html.includes('Só pegue se você faz esse serviço. O crédito não volta.'));
assert.ok(html.includes('const novoChamado = !req.abertoTodos && '));
assert.ok(html.includes('CallInfo.vagasHtml(req) +'));

// Módulo QFAbertos, rodado isolado.
const a = html.indexOf('  global.QFAbertos = {');
const b = html.indexOf('\n  };\n', a);
assert.ok(a > 0 && b > a);
const g = {};
const ctx = { global: g, Number, Date, Math, PU: { escapeHtml: (v) => String(v) }, icon: () => '<svg></svg>', chamadaCard: (r) => '<card ' + r.id + '>' };
vm.runInNewContext(html.slice(a, b + 5), ctx);
const Q = g.QFAbertos;

// Do mais perto para o mais longe; sem distância vai para o fim (na mesma cidade antes).
const ordem = Q.ordenar([
  { id: 'longe', distanciaKm: 253.1 }, { id: 'semkm', distanciaKm: null }, { id: 'perto', distanciaKm: 4.2 },
  { id: 'cidade', distanciaKm: null, mesmaCidade: true }
]).map((r) => r.id);
assert.deepEqual(ordem, ['perto', 'longe', 'cidade', 'semkm']);

// Seção só aparece quando há pedido aberto.
assert.equal(Q.secaoHtml([], {}), '');
const sec = Q.secaoHtml([{ id: 'x1' }, { id: 'x2' }], {});
assert.ok(sec.includes('Abertos a todos') && sec.includes('<card x1>') && sec.includes('<card x2>') && sec.includes('>2</span>'));

// Faixa de movimento: usa o dia quando há 3 ou mais pedidos; senão, os últimos 7 dias; sem pedido, não aparece.
assert.deepEqual({ ...Q.movimentoTexto({ hoje: 14, semana: 40, sem_profissional: 5 }) }, { titulo: '14 pedidos hoje no QuemFaz', sub: '5 ainda sem profissional' });
assert.deepEqual({ ...Q.movimentoTexto({ hoje: 2, semana: 5, sem_profissional: 0 }) }, { titulo: '5 pedidos nos últimos 7 dias', sub: 'Todos já têm profissional' });
assert.equal(Q.movimentoTexto({ hoje: 0, semana: 1, sem_profissional: 1 }).titulo, '1 pedido nos últimos 7 dias');
assert.equal(Q.movimentoTexto({ hoje: 0, semana: 0 }), null);
assert.equal(Q.movimentoTexto(null), null);
g.QFMovimento = null;
assert.equal(Q.movimentoHtml(), '');

console.log('abertos-a-todos: ok');
