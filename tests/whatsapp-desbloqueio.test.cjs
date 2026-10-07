const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-03-whatsapp-no-desbloqueio.sql'), 'utf8');

// Scripts continuam com sintaxe válida.
[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));

// Mensagem pronta e link do WhatsApp.
const a = html.indexOf('  function whatsappHref(phone, message) {');
const b = html.indexOf('  global.QFUI.telHref = telHref;');
assert.ok(a > 0 && b > a);
const scope = { global: {} };
vm.runInNewContext(html.slice(a, b), scope);
const ui = scope.global.QFUI;
const msg = ui.primeiroContatoMsg({ nome: 'Luciane Almeida' }, { nome: 'Ubaldino' }, { nome: 'Pedreiro' });
assert.match(msg, /^Olá, Luciane! Sou Ubaldino, profissional pelo QuemFaz\. Vi seu pedido de Pedreiro/);
assert.match(ui.primeiroContatoMsg(null, null, null), /^Olá! Sou profissional, profissional pelo QuemFaz\. Vi seu pedido e estou/);
assert.equal(ui.whatsappHref('(11) 96653-2473', 'oi'), 'https://wa.me/5511966532473?text=oi');
assert.equal(ui.whatsappHref('', 'oi'), '');

// Tela de conversa do profissional mostra o botão; sem telefone mantém o texto antigo.
assert.ok(html.includes('data-qf-wa-card'));
assert.ok(html.includes("r.cliente_whatsapp || r.cliente_telefone || ''"));
assert.ok(html.includes('Chat liberado para negociação</strong>'));

// Textos do cliente não prometem mais telefone protegido.
assert.ok(!html.includes('Seu WhatsApp é protegido e só é liberado'));
assert.ok(!html.includes('Telefone e endereço exato continuam protegidos'));
assert.ok(html.includes('Usado para falar com você sobre este pedido.'));

// Banco: telefone só durante a negociação ou após proposta aceita; endereço segue protegido.
assert.match(sql, /when c\.status='em_negociacao' or private\.qf_prof_has_accepted_quote\(c\.id,auth\.uid\(\)\) then p\.whatsapp/);
assert.match(sql, /when private\.qf_prof_has_accepted_quote\(c\.id,auth\.uid\(\)\) then c\.endereco_completo else null/);
console.log('whatsapp-desbloqueio: ok');
