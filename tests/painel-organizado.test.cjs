const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

// Scripts continuam com sintaxe válida.
[...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'admin-' + i + '.js' }));

// As cinco partes do painel, na ordem combinada (a ordem no celular vem do CSS).
['Entrada de hoje', 'Precisa de você', 'Como está indo', 'Últimos pedidos', 'Atalhos'].forEach((t) => assert.ok(admin.includes(t), t));
assert.ok(admin.includes('.qf-p-receita{order:1}.qf-p-precisa{order:2}.qf-p-indo{order:3}.qf-p-pedidos{order:4}.qf-p-atalhos{order:5}'));

// Nada saiu do painel: os blocos antigos continuam existindo (agora em gavetas).
['id="parados"', 'id="sem-resposta"', 'id="cascata"', 'id="aviso-geral"', 'id="bonus-massa"', 'id="admin-fechamento"', 'id="admin-alertas-chamado"', 'id="admin-alert-metrics"', 'data-action="admin-refresh"', 'data-admin-install-slot']
  .forEach((t) => assert.ok(admin.includes(t), t));
["gaveta('parados'", "gaveta('sem-resposta'", "gaveta('detalhes'", "gaveta('aviso'", "gaveta('bonus'", "gaveta('cascata'"].forEach((t) => assert.ok(admin.includes(t), t));
["kpi(s.pedidosAbertos, 'Pedidos abertos', 'solicitados')", "kpi(s.cancelados, 'Cancelados', 'cancelados')"].forEach((t) => assert.ok(admin.includes(t), t));
['data-nav="/admin/sem-push"', 'data-nav="/admin/suporte"', 'data-nav="/admin/profissionais"', 'data-nav="/admin/clientes"', 'data-nav="/admin/pagamentos"', 'data-nav="/admin/servicos"']
  .forEach((t) => assert.ok(admin.includes(t), t));

// V11.29.1: o número grande é a entrada de HOJE (zera à meia-noite) e soma dinheiro, crédito e bônus;
// o total geral e o dinheiro real ficam logo abaixo.
assert.ok(admin.includes('dinheiroEntrou: recargas + receitaPrioridade + receitaAnuncios,'));
assert.ok(admin.includes('PU.formatCurrency(en.hoje)') && admin.includes('PU.formatCurrency(en.geral)') && admin.includes('zera à meia-noite'));
assert.ok(admin.includes('Total geral') && admin.includes('Dinheiro real (Pix, cartão e boleto): hoje '));
{
  const i = admin.indexOf('  function diaSP(d) {');
  const j = admin.indexOf('  function dashboardStats() {');
  const sc = { Date, Number, isNaN };
  vm.runInNewContext(admin.slice(i, j) + '\nthis.dia = diaSP; this.res = entradaResumo;', sc);
  assert.equal(sc.dia('2026-10-05T02:59:00Z'), '2026-10-04'); // 23h59 em Brasília ainda é o dia anterior
  assert.equal(sc.dia('2026-10-05T03:00:00Z'), '2026-10-05'); // meia-noite: vira o dia
  const ev = [
    { grupo: 'desbloqueio', creditos: true, valor: 490, criadoEm: '2026-10-05T12:00:00Z' },
    { grupo: 'desbloqueio', creditos: true, valor: 490, criadoEm: '2026-10-05T13:00:00Z' },
    { grupo: 'desbloqueio', creditos: true, valor: 990, criadoEm: '2026-10-04T12:00:00Z' },  // ontem
    { grupo: 'prioridade', valor: 490, criadoEm: '2026-10-05T14:00:00Z' },
    { grupo: 'plano', valor: 10000, criadoEm: '2026-10-05T15:00:00Z' },
    { grupo: 'recarga', valor: 5000, criadoEm: '2026-10-05T16:00:00Z' },                    // não conta duas vezes
    { grupo: 'anuncio', valor: 19900, criadoEm: '2026-10-03T12:00:00Z' },
  ];
  const r = sc.res(ev, '2026-10-05');
  assert.equal(r.hoje, 490 + 490 + 490 + 10000);
  assert.equal(r.desbloqueiosHoje, 980); assert.equal(r.desbloqueiosHojeQtd, 2);
  assert.equal(r.prioridadeHoje, 490); assert.equal(r.anunciosPlanosHoje, 10000);
  assert.equal(r.geral, 490 + 490 + 990 + 490 + 10000 + 19900);
  assert.equal(r.dinheiroHoje, 490 + 10000 + 5000);
  assert.equal(sc.res(ev, '2026-10-06').hoje, 0); // no dia seguinte, zera
}
assert.ok(admin.includes("origem: m.referencia_tipo || null"));
{
  const i = admin.indexOf('  function isRecargaPaga(t) {');
  const sc = {};
  vm.runInNewContext(admin.slice(i, admin.indexOf('\n', i)) + '\nthis.f = isRecargaPaga;', sc);
  assert.equal(sc.f({ tipo: 'credito', origem: 'recarga' }), true);   // recarga paga (Pix/cartão/boleto)
  assert.equal(sc.f({ tipo: 'recarga' }), true);                      // modo offline
  assert.equal(sc.f({ tipo: 'credito', origem: 'admin' }), false);    // crédito dado pelo admin
  assert.equal(sc.f({ tipo: 'bonus', origem: 'bonus_lancamento' }), false);
  assert.equal(sc.f({ tipo: 'debito', origem: 'chamado' }), false);
}

// Um período só; "Tudo" pede 90 dias de alertas (limite da função do banco).
assert.ok(admin.includes('id="admin-periodo"') && !admin.includes('admin-alert-days') && !admin.includes('admin-fech-dias'));
assert.ok(admin.includes('loadAlertMetrics(content, painelDias || 90);'));

// Aviso de celular (#parados / #sem-resposta) abre a gaveta certa.
assert.ok(admin.includes("global.QFPainel.abrir('parados')") && admin.includes("global.QFPainel.abrir('sem-resposta')"));

// Resumo dos alertas.
const a = admin.indexOf('  function minutosTxt(v) {');
const b = admin.indexOf('  function alertRotulo(dias) {');
assert.ok(a > 0 && b > a);
const scope = { Number, Math };
vm.runInNewContext(admin.slice(a, b) + '\nthis.r = alertResumoHtml; this.m = minutosTxt;', scope);
assert.equal(scope.m(26.5), '26,5 min');
const h = scope.r({ chamados: 5, aceitos: 3, minutos_ate_aceite_media: 26.5 });
assert.ok(h.includes('3 de 5 · 60%') && h.includes('width:60%') && h.includes('média 26,5 min'));
assert.ok(scope.r({ chamados: 0 }).includes('Nenhum chamado neste período.'));
assert.ok(scope.r({ chamados: 2, aceitos: 0 }).includes('0 de 2 · 0%'));

// V11.27.2: recargas e planos pagos vêm da tabela de pagamentos (plano pago não vira crédito na carteira).
assert.ok(admin.includes('d.recargas_aprovadas') && admin.includes('recargasPagas().reduce('));
{
  const i = admin.indexOf('  function recargasPagas() {');
  const j = admin.indexOf('  function isPaidUnlock(r) {');
  assert.ok(i > 0 && j > i);
  const run = (state) => { const sc = { state, Array, Number }; vm.runInNewContext(admin.slice(i, j) + '\nthis.f = recargasPagas;', sc); return sc.f(); };
  // painel conectado: usa a lista do banco (inclui plano), ignora as movimentações
  const banco = run({ recargasPagas: [{ valor: 5000, plano: null }, { valor: 10000, plano: 'mensal' }], transactions: [{ tipo: 'credito', origem: 'recarga', valor: 5000 }] });
  assert.equal(banco.reduce((s, p) => s + p.valor, 0), 15000);
  // sem a lista (banco antigo ou modo offline): cai nas movimentações de recarga
  const antigo = run({ recargasPagas: null, transactions: [{ tipo: 'credito', origem: 'recarga', valor: 5000 }, { tipo: 'credito', origem: 'admin', valor: 1500 }, { tipo: 'bonus', valor: 2500 }] });
  assert.equal(antigo.reduce((s, p) => s + p.valor, 0), 5000);
}
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '2026-10-05-snapshot-recargas-aprovadas.sql'), 'utf8');
assert.ok(sql.includes("'recargas_aprovadas'") && sql.includes("r.status = 'aprovado'"));

console.log('painel-organizado: ok');
