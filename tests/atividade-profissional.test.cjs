// V11.58: perfil do profissional no painel mostra quantos pedidos ele desbloqueou, quantos finalizou e as notas dos clientes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

[...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'admin-' + i + '.js' }));
['adminProfAtivHtml(p) +', 'adminProfAtivLinha(p)', 'DB.state.avaliacoesAdmin = (d.avaliacoes || [])', 'Pedidos que ele desbloqueou', 'Nota dos clientes']
  .forEach((t) => assert.ok(admin.includes(t), t));

const cut = (a, b) => admin.slice(admin.indexOf(a), admin.indexOf(b));
const src = cut('  function desbloqueiosAtivos(r) {', '  // ---------------- V11.22: fluxo simples') +
  cut("  const QF_TZ = 'America/Sao_Paulo';", '  // Extrato: uma linha por desbloqueio') +
  cut('  function adminProfAtividade(proId) {', '  function profCard(p) {');
const d = (pro, valor, desfecho, origem) => ({ profissionalId: pro, valor, origem: origem || 'saldo', ativo: true, desfecho: desfecho || null, criadoEm: '2026-10-05T09:46:00Z' });
const sc = {
  Date, Number, String, Math, isNaN, Array,
  PU: { escapeHtml: (v) => String(v).replace(/</g, '&lt;'), formatCurrency: (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',') },
  DB: {
    categoryById: () => ({ nome: 'Montador de móveis' }),
    state: {
      requests: [
        { id: 'a', categoriaId: 'x', titulo: 'Guarda-roupa', desbloqueios: [d('p1', 790, 'fechado'), d('p2', 790, 'nao_fechado')] },
        { id: 'b', categoriaId: 'x', titulo: '', desbloqueios: [d('p1', 790, 'fechado'), Object.assign(d('p1', 500), { ativo: false })] },
        { id: 'c', categoriaId: 'x', titulo: '', desbloqueios: [d('p1', 790, null, 'plano')] },
      ],
      avaliacoesAdmin: [
        { requestId: 'a', profissionalId: 'p1', autor: 'cliente', nota: 4, comentario: 'Bom <b>' },
        { requestId: 'a', profissionalId: 'p1', autor: 'profissional', nota: 5, comentario: '' }, // nota que ELE deu não conta
        { requestId: 'a', profissionalId: 'p2', autor: 'cliente', nota: 1, comentario: '' },
      ],
    },
  },
};
vm.runInNewContext(src + '\nthis.at = adminProfAtividade; this.linha = adminProfAtivLinha; this.html = adminProfAtivHtml;', sc);
const a = sc.at('p1');
assert.equal(a.total, 3);            // desbloqueio desativado não entra
assert.equal(a.fechados, 2);
assert.equal(a.naoFechados, 0);
assert.equal(a.semResposta, 1);
assert.equal(a.gasto, 1580);         // o do plano não soma valor
assert.equal(a.notas.length, 1);
assert.equal(a.media, 4);
assert.equal(sc.at('p2').naoFechados, 1);
assert.match(sc.linha({ id: 'p1' }), /<b>3<\/b> desbloqueios · <b>2<\/b> finalizados · Nota: <b>4,0 \(1 nota\)<\/b>/);
assert.match(sc.linha({ id: 'zz' }), /Nenhum desbloqueio ainda/);
const h = sc.html({ id: 'p1' });
assert.ok(h.includes('Cliente deu nota 4') && h.includes('Bom &lt;b>') && h.includes('Cliente ainda não deu nota') && h.includes('Sem resultado ainda'));
assert.ok(sc.html({ id: 'zz' }).includes('ainda não desbloqueou nenhum pedido'));
console.log('PASS atividade do profissional: desbloqueios, finalizados e notas');
