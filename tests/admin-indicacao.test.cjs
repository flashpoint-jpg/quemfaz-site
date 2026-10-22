// Indicação no painel admin: etiqueta "Indicado", bônus de quem indicou e verificação depois do corte de 16/10/2026.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261018230000_indicacao_bonus_e_painel_admin.sql'), 'utf8');

// Banco: verificar não tenta mais o bônus de lançamento depois do corte; indicação segue valendo; consulta só para admin.
assert.ok(sql.includes("now() < '2026-10-16 03:00:00+00'::timestamptz then\n    insert into public.qf_movimentacoes_carteira"), 'bônus de lançamento só antes do corte');
assert.ok(sql.includes("coalesce(new.referencia_tipo, '') <> 'indicacao'"), 'bônus de indicação é a única exceção ao corte');
assert.ok(sql.includes("'qf-bonus-indicacao'") && sql.includes('exception when others then\n      raise warning'), 'push ao indicador, sem derrubar o pagamento se falhar');
assert.ok(sql.includes('private.qf_is_admin()') && sql.includes('revoke execute on function public.qf_admin_indicacoes() from public, anon;'));
const consulta = sql.slice(sql.indexOf('create or replace function public.qf_admin_indicacoes'));
assert.ok(!/\b(insert\s+into|update\s+public\.|delete\s+from|alter\s+table|drop\s+table)\b/i.test(consulta), 'consulta só lê');

// Tela: carrega as indicações com fallback, mostra a etiqueta nas listas e o aviso no perfil.
assert.ok(admin.includes("client.rpc('qf_admin_indicacoes')"));
assert.ok(admin.includes("indicadoPor: indicadoPor[p.id] || null, indicacoesFeitas: indicouLista[p.id] || []"));
assert.ok(admin.includes("(p.indicadoPor ? '<span class=\"badge badge--orange\">Indicado</span>' : '')"));
assert.ok(admin.includes('adminIndicacaoHtml(p) +\n      adminProfAtivHtml(p) +'), 'aviso aparece no perfil, antes da atividade');

const pick = (a, b) => { const i = admin.indexOf(a), j = admin.indexOf(b, i); assert.ok(i > 0 && j > i, a); return admin.slice(i, j); };
const code = [
  pick('  function rowInfoHtml(label, html)', '  function rowInfoLong'),
  pick('  function adminIndicacaoHtml(p) {', '  function adminProfAtivLinha'),
  'this.f = adminIndicacaoHtml;'
].join('\n');
const esc = (x) => String(x).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const sc = {
  PU: {
    formatCurrency: (c) => ((Number(c) || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' '),
    escapeHtml: esc,
    formatDateTime: () => '18/10/2026 22:56'
  },
  DB: { profissionalById: (id) => (id === 'j1' ? { nome: 'Juarez <b>M.</b>' } : null) }
};
vm.runInNewContext(code, sc);

// Sem indicação, nada aparece.
assert.equal(sc.f({ indicadoPor: null, indicacoesFeitas: [] }), '');

// Indicado e ainda pendente: diz quem ganha e quanto ao verificar.
const pend = sc.f({ indicadoPor: { indicador_nome: 'Marcos <i>Iran</i>', status: 'pendente', bonus_centavos: 1000 }, indicacoesFeitas: [] });
assert.ok(pend.includes('Veio por indicação de Marcos &lt;i&gt;Iran&lt;/i&gt;'), 'nome escapado');
assert.ok(pend.includes('Ao marcar como verificado, Marcos &lt;i&gt;Iran&lt;/i&gt; ganha R$ 10,00'));
assert.ok(pend.includes('badge--orange">Indicado'));

// Já pago: mostra quando.
const pago = sc.f({ indicadoPor: { indicador_nome: 'Marcos', status: 'pago', bonus_centavos: 1000, pago_em: '2026-10-19T01:56:05Z' }, indicacoesFeitas: [] });
assert.ok(pago.includes('Marcos recebeu R$ 10,00 de bônus de indicação em 18/10/2026 22:56'));

// Bônus desligado: não promete pagamento.
const off = sc.f({ indicadoPor: { indicador_nome: 'Marcos', status: 'pendente', bonus_centavos: 0 }, indicacoesFeitas: [] });
assert.ok(off.includes('desligado') && !off.includes('ganha'));

// Quem indicou: resumo com pagos e pendentes.
const quem = sc.f({ indicadoPor: null, indicacoesFeitas: [
  { indicado_id: 'j1', status: 'pago', bonus_centavos: 1000 },
  { indicado_id: 'x9', status: 'pendente', bonus_centavos: 1000 }
] });
assert.ok(quem.includes('Indicou') && quem.includes('2 profissionais'));
assert.ok(quem.includes('1 · R$ 10,00'), 'um bônus pago somando R$ 10,00');
assert.ok(quem.includes('Juarez &lt;b&gt;M.&lt;/b&gt;') && quem.includes('Aguardando verificação'));
console.log('PASS indicação: etiqueta, aviso no perfil, bônus pós-corte e consulta só de leitura');
