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

// Testa a interface realmente gerada no acompanhamento do profissional.
const start = comissao.indexOf('function suporteProfHtml(');
const end = comissao.indexOf('function contatoAdminHtml(', start);
assert.ok(start >= 0 && end > start);
const scope = {
  esc: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
  encodeURIComponent
};
vm.runInNewContext(comissao.slice(start, end), scope);
const chat = scope.suporteProfHtml('pedido-de-teste', true);
assert.match(chat, /Abrir chat com cliente/);
assert.match(chat, /href="#\/profissional\/chat\/pedido-de-teste"/);
assert.match(chat, /Falar diretamente com o cliente/);
assert.match(chat, /Suporte fala com a equipe Quem Faz, não com o cliente/);
assert.ok(chat.indexOf('Abrir chat com cliente') < chat.indexOf('Falar com suporte no WhatsApp'));

const finalizado = scope.suporteProfHtml('pedido-de-teste', false);
assert.doesNotMatch(finalizado, /Abrir chat com cliente/);
assert.match(finalizado, /Falar com suporte no WhatsApp/);

// Após desbloquear, a sincronização não pode ser ignorada pelo cache de 1,2 s.
assert.match(livre, /if\(g\.QFCloud\.syncForCurrentSession\)await g\.QFCloud\.syncForCurrentSession\(true\);g\.navigate\('\/profissional\/chat\/'\+params\.id,true\);/);

// A tela do Livre não deve entregar o WhatsApp do cliente — só o Avulso.
assert.doesNotMatch(scope.suporteProfHtml('pedido-de-teste'), /data-contact="whatsapp"/);
console.log('contato-cliente-livre: ok');
