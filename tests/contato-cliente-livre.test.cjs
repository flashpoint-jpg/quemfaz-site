const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const comissao = fs.readFileSync(path.join(root, 'qf-comissao13.js'), 'utf8');
const livre = fs.readFileSync(path.join(root, 'qf-livre.js'), 'utf8');

// Os dois scripts precisam continuar válidos.
new vm.Script(comissao, { filename: 'qf-comissao13.js' });
new vm.Script(livre, { filename: 'qf-livre.js' });

// Testa a nova regra aprovada: cliente acessível por chat E WhatsApp após desbloqueio.
const start = comissao.indexOf('function suporteProfHtml(');
const end = comissao.indexOf('function contatoAdminHtml(', start);
assert.ok(start >= 0 && end > start);
const scope = {
  g: {DB:{
    requestById: () => ({profissionalId:'pro-1', clienteId:'cliente-1'}),
    clienteById: () => ({nome:'Ana',telefone:'11987654321'})
  }},
  esc: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  encodeURIComponent
};
vm.runInNewContext(comissao.slice(start, end), scope);
const chat = scope.suporteProfHtml('pedido-de-teste', true);
assert.match(chat, /Chat no app/);
assert.match(chat, /WhatsApp do cliente/);
assert.match(chat, /data-contact="whatsapp"/);
assert.match(chat, /wa\.me\/5511987654321/);
assert.match(chat, /href="#\/profissional\/chat\/pedido-de-teste"/);
assert.match(chat, /Falar com o cliente/);
assert.match(chat, /O suporte é da equipe Quem Faz/);
assert.ok(chat.indexOf('Chat no app') < chat.indexOf('Falar com suporte'));
const finalizado = scope.suporteProfHtml('pedido-de-teste', false);
assert.doesNotMatch(finalizado, /data-contact="whatsapp"/);
assert.match(finalizado, /Falar com suporte/);
scope.g.DB.requestById=()=>null;
assert.doesNotMatch(scope.suporteProfHtml('pedido-de-teste'), /data-contact="whatsapp"/);

// Após desbloquear, a sincronização não pode ser ignorada pelo cache de 1,2 s.
assert.match(livre, /if\(g\.QFCloud\.syncForCurrentSession\)await g\.QFCloud\.syncForCurrentSession\(true\);g\.navigate\('\/profissional\/chat\/'\+params\.id,true\);/);

// O número só pode ser mostrado quando o banco fornecer o contato após desbloqueio.
console.log('contato-cliente-livre: ok');
