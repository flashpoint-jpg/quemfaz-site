const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

// Scripts continuam com sintaxe válida.
[...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'admin-' + i + '.js' }));

// As cinco partes do painel, na ordem combinada (a ordem no celular vem do CSS).
['Receita total', 'Precisa de você', 'Como está indo', 'Últimos pedidos', 'Atalhos'].forEach((t) => assert.ok(admin.includes(t), t));
assert.ok(admin.includes('.qf-p-receita{order:1}.qf-p-precisa{order:2}.qf-p-indo{order:3}.qf-p-pedidos{order:4}.qf-p-atalhos{order:5}'));

// Nada saiu do painel: os blocos antigos continuam existindo (agora em gavetas).
['id="parados"', 'id="sem-resposta"', 'id="cascata"', 'id="aviso-geral"', 'id="bonus-massa"', 'id="admin-fechamento"', 'id="admin-alertas-chamado"', 'id="admin-alert-metrics"', 'data-action="admin-refresh"', 'data-admin-install-slot']
  .forEach((t) => assert.ok(admin.includes(t), t));
["gaveta('parados'", "gaveta('sem-resposta'", "gaveta('detalhes'", "gaveta('aviso'", "gaveta('bonus'", "gaveta('cascata'"].forEach((t) => assert.ok(admin.includes(t), t));
["kpi(s.pedidosAbertos, 'Pedidos abertos', 'solicitados')", "kpi(s.cancelados, 'Cancelados', 'cancelados')"].forEach((t) => assert.ok(admin.includes(t), t));
['data-nav="/admin/sem-push"', 'data-nav="/admin/suporte"', 'data-nav="/admin/profissionais"', 'data-nav="/admin/clientes"', 'data-nav="/admin/pagamentos"', 'data-nav="/admin/servicos"']
  .forEach((t) => assert.ok(admin.includes(t), t));

// V11.27.1: o número grande é só dinheiro que entrou; desbloqueio com crédito fica numa linha à parte.
assert.ok(admin.includes('dinheiroEntrou: recargas + receitaPrioridade + receitaAnuncios,'));
assert.ok(admin.includes("PU.formatCurrency(s.dinheiroEntrou)") && !admin.includes("PU.formatCurrency(s.faturamento)"));
assert.ok(admin.includes('Desbloqueios com créditos') && admin.includes("item('Recargas de profissionais', s.recargas)"));
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

console.log('painel-organizado: ok');
