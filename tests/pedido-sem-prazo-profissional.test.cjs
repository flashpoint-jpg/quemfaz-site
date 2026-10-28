// V11.97.5 — antes do desbloqueio o profissional não vê Sem pressa / Com pressa / Agendado / data pretendida.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ext = fs.readFileSync(path.join(root, 'scripts', 'qf-other-jobs-extension.js'), 'utf8');
const push = fs.readFileSync(path.join(root, 'supabase', 'functions', 'quemfaz-push', 'index.ts'), 'utf8');

const COMUM = 'Cliente aguardando propostas. Desbloqueie o contato para conversar, apresentar seu orçamento e combinar a melhor data para o serviço.';
const URGENTE = 'PEDIDO PRIORITÁRIO — Cliente deu prioridade ao pedido. Desbloqueie para entrar em contato.';

// Módulo QFPrazo + mensagem, rodado isolado.
const a = html.indexOf('/* QuemFaz V11.29 — prazo do pedido');
const b = html.indexOf('/* QuemFaz — dados do Supabase');
const win = { PU: { escapeHtml: (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;') }, icon: () => '<svg></svg>' };
vm.runInNewContext(html.slice(html.indexOf('(function (global) {', a), b), { window: win, Date, Math, Number, String, Array });
const M = win.QFPedidoMsg;
assert.ok(M);
assert.equal(M.COMUM, COMUM);
assert.equal(M.URGENTE, URGENTE);

// 1-4: pedido comum sem prazo, antigo "sem pressa", agendado, e urgência paga.
const semPrazo = { id: 'a', prioridade: false };
const semPressa = { id: 'b', prioridade: false, prazo: 'sem_pressa' };
const agendado = { id: 'c', prioridade: false, prazo: 'data', prazoDia: '2026-10-25', periodo: 'tarde', dataPreferida: '2026-10-25T15:00:00Z' };
const hoje = { id: 'd', prioridade: false, prazo: 'hoje', prazoDia: '2026-10-17' };
const pago = { id: 'e', prioridade: true, prazo: 'sem_pressa' };
[semPrazo, semPressa, agendado, hoje].forEach((r) => {
  assert.equal(M.texto(r), COMUM);
  const h = M.html(r);
  assert.ok(h.includes(COMUM) && !h.includes('urgente'.toUpperCase() + ' —') && !h.includes('qf-pedido-msg--urgente'));
});
assert.equal(M.texto(pago), URGENTE);
assert.ok(M.html(pago).includes('qf-pedido-msg--urgente'));
// Os dados originais não são alterados.
assert.equal(agendado.prazo, 'data'); assert.equal(agendado.prazoDia, '2026-10-25'); assert.equal(agendado.dataPreferida, '2026-10-25T15:00:00Z');

// Cartão da lista: sem selo/linha de prazo, URGENTE só com prioridade.
const cardSrc = html.slice(html.indexOf('  function chamadaCard(req, user) {'), html.indexOf('  global.QFChamadaCard = chamadaCard;'));
assert.ok(cardSrc.length > 500);
['QFPrazo', 'prazoInfo', 'seloHtml', 'linhaHtml', 'dataPreferida', 'QFExecLabel', 'data-qf-sem-pressa', 'data-qf-execucao', 'Execução', 'Sem pressa'].forEach((t) => assert.ok(!cardSrc.includes(t), 'cartão ainda tem ' + t));
// URGENTE (vermelho) vem da escolha grátis do cliente; Normal é discreto; a prioridade paga tem selo próprio.
assert.ok(cardSrc.includes("const urgente = global.QFUrgencia.ehUrgente(req);"));
assert.ok(cardSrc.includes("global.QFUrgencia.tagHtml(req) + global.QFUrgencia.prioridadeHtml(req)"));
assert.ok(cardSrc.includes('QFPedidoMsg.html(req)'));
// Mantém o que deve ficar: tipo, descrição, local, km, novo, vagas, botão de desbloqueio.
['cat.nome', 'req.descricao', 'req.endereco.bairro', 'CallInfo.kmTxt(req)', 'qf-new-call-badge', 'CallInfo.vagasHtml(req)', 'qf-unlock-price', 'Desbloquear por'].forEach((t) => assert.ok(cardSrc.includes(t), 'cartão perdeu ' + t));

// Detalhe bloqueado: sem "Quando precisa", sem resumo de prazo.
const detStart = html.indexOf("'<div class=\"text--sm text--strong\" style=\"color:var(--orange-700);text-transform:uppercase;letter-spacing:.06em;\">Detalhes do pedido</div>'");
const detSrc = html.slice(detStart, html.indexOf("'<div class=\"qf-perf\" aria-hidden=\"true\"", detStart));
assert.ok(detSrc.length > 300 && !detSrc.includes('Quando precisa') && !detSrc.includes('QFPrazo'));
const profCall = html.slice(html.indexOf('Screens.profChamadaRender = function (params,user) {'), html.indexOf('const oldClientDetail'));
assert.ok(profCall.includes('QFPedidoMsg.html(req)') && !profCall.includes('scheduleSummary'));

// Tela cheia, aviso interno e ordenação.
const ov = html.slice(html.indexOf("'<div class=\"qf-call-overlay__icon\">'"), html.indexOf("'<div class=\"qf-call-overlay__lock\">'"));
assert.ok(ov.includes('QFPedidoMsg') && ov.includes('URGENTE') && ov.includes('QFUrgencia.ehUrgente(req)') && !ov.includes('QFPrazo'));
assert.ok(!html.includes('pz ? pz.texto'));
assert.ok(!html.includes('data-qf-portfolio-period aria-label'));
assert.ok(!html.includes('QFPrazo.comparar'));
assert.ok(/function qfUrgent\(req\)\{\s*return !!\(req && req.prioridade\);/.test(html));

// Aba de pedidos da home (cartões reais) e "Outros pedidos".
assert.ok(!ext.includes('SEM PRESSA') && !ext.includes('PRA HOJE') && !ext.includes('Previsto:') && !ext.includes('Data a combinar') && !ext.includes('qfOutrosPrazo'));
assert.ok(ext.includes('QFUrgencia') && ext.includes('U.tagHtml(req)+U.prioridadeHtml(req)'));

// Push: sem data/horário pretendido; urgência paga com título próprio; regras de envio intactas.
const body = push.slice(push.indexOf('function newCallBody'), push.indexOf('async function newCallPayloads'));
assert.ok(!body.includes('data_preferida') && !body.includes('Execução'));
assert.ok(push.includes('"PEDIDO URGENTE: "'));
assert.ok(push.includes('scheduledAt > Date.now() + 24 * 60 * 60 * 1000'), 'regra de envio de pedidos agendados não pode mudar');

// Outubro/2026: depois do desbloqueio também não aparece mais prazo/agendamento; o dia é combinado direto com o cliente.
assert.ok(!html.includes("'Para quando você pediu' : 'Quando o cliente precisa'"));
assert.ok(!html.includes("<strong>Quando:</strong> ' + PU.escapeHtml(pz.texto)"));
assert.ok(html.includes('function scheduleSummary(req, paraCliente) {'));
// Formulário do cliente: sem campo de prazo; pedido novo grava só a urgência grátis.
assert.ok(!html.includes("opt('sem_pressa', 'Sem pressa', true)"));
assert.ok(html.includes("if (comUrgencia) row.urgencia = data.urgencia;"));
console.log('pedido-sem-prazo-profissional: ok');
