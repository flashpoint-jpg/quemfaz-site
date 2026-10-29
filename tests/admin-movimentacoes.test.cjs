// V12.1: página "Movimentações" do painel admin (entradas, quem desbloqueou, planos, tempo real).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = require('../scripts/prepare-admin-organizacao.cjs')(fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8'));
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '2026-10-18-admin-movimentacoes.sql'), 'utf8');

// Rota, item no menu (em "Dinheiro e planos"), carga ao abrir e atualização sozinha.
assert.ok(admin.includes("{ pattern: '/admin/movimentacoes', role: 'admin', title: 'Movimentações'"));
assert.ok(admin.includes("{ id: 'movimentacoes', label: 'Movimentações', icon: 'dashboard', route: '/admin/movimentacoes' }"));
assert.ok(admin.includes("if (pattern === '/admin/movimentacoes') admMovCarregar(content);"));
assert.ok(/setInterval\(function \(\) \{\s*if \(document\.hidden\) return;\s*const box = document\.querySelector\('\[data-adm-mov\]'\);[\s\S]*?\}, 10000\);/.test(admin), 'atualiza a cada 10 s sem F5');
assert.ok(admin.includes("if (box.__qfHtml !== h) { box.__qfHtml = h; box.innerHTML = h; }"), 'só redesenha se mudou (sem piscar)');
assert.ok(admin.includes("rpc('qf_admin_movimentacoes', { p_dias: admMovDias })"));

// A consulta é só de leitura, exige admin e não mexe em tabela nenhuma.
assert.ok(sql.includes('private.qf_is_admin()'));
assert.ok(!/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|drop\s+table)\b/i.test(sql));
assert.ok(sql.includes("revoke all on function public.qf_admin_movimentacoes(integer) from public, anon;"));
assert.ok(sql.includes("coalesce(d.ativo, true)"), 'desbloqueio devolvido não conta');
assert.ok(sql.includes("r.status = 'aprovado' and r.plano is null"), 'recarga de carteira separada');

// Monta a tela com dados no formato da consulta e confere as somas.
const pick = (a, b) => { const i = admin.indexOf(a), j = admin.indexOf(b, i); assert.ok(i > 0 && j > i, a); return admin.slice(i, j); };
const code = [
  pick('  function qfHora(iso)', '  function qfDiaChave'),
  pick('  function qfDiaChave(iso)', '\n'),
  pick('  function admCard(titulo', '  // Situação do pedido em uma palavra'),
  pick('  let admMovDias = 1, admMovSeq = 0;', '  async function admMovCarregar'),
  'this.f = admMovHtml;'
].join('\n');
const sc = {
  QF_TZ: 'America/Sao_Paulo',
  migrationBanner: () => '',
  PU: {
    formatCurrency: (c) => ((Number(c) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    escapeHtml: (x) => String(x).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
  }
};
vm.runInNewContext(code, sc);
const nbsp = (t) => t.replace(/ /g, ' ');
const hoje = new Date().toISOString();
const html = nbsp(sc.f({
  ok: true, dias: 1,
  resumo: { desbloqueios_qtd: 5, desbloqueios_centavos: 2900, planos_qtd: 1, planos_centavos: 4990, urgentes_qtd: 1, urgentes_centavos: 990, anuncios_qtd: 0, anuncios_centavos: 0, recargas_qtd: 1, recargas_centavos: 5000 },
  planos: [{ plano: 'mensal', nome: 'Mensal', preco_centavos: 4990, chamados: 7, ativos: 1, vendidos_qtd: 1, vendidos_centavos: 4990 }],
  avulso_profissionais: 287,
  ranking: [{ profissional_id: 'a1', nome: 'Edson <b>L.</b>', qtd: 2, centavos: 4100, ultimo_em: hoje }],
  movimentos: [
    { em: hoje, tipo: 'plano', quem: 'Marcos P.', detalhe: 'Plano Mensal · 7 chamados', centavos: 4990 },
    { em: hoje, tipo: 'recarga', quem: 'Jorge T.', detalhe: 'Carteira · pix', centavos: 5000 }
  ],
  movimentos_total: 2
}));
assert.ok(html.includes('<span>Entrou hoje</span><b>R$ 88,80</b>'), 'Entrou = desbloqueios + planos + urgentes (29,00 + 49,90 + 9,90), sem a recarga');
assert.ok(html.includes('<b>R$ 50,00</b><small class="qf-mov-sub">Vira desbloqueio depois'), 'recarga num cartão próprio');
assert.ok(html.includes('(56%)'), 'planos são 56% do que entrou');
assert.ok(html.includes('Edson &lt;b&gt;L.&lt;/b&gt;'), 'nomes são escapados');
assert.ok(html.includes('+ R$ 49,90') && !html.includes('+ R$ 50,00'), 'recarga não aparece como entrada');
assert.ok(html.includes('287 profissionais'));
console.log('PASS movimentações: rota, menu, tempo real, consulta só de leitura e somas');

