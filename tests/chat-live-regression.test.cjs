const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-02-chat-ao-vivo-aviso-unico.sql'), 'utf8');

// Todos os scripts da página continuam com sintaxe válida.
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
assert.ok(scripts.length > 3);
scripts.forEach((code, i) => new vm.Script(code, { filename: 'inline-' + i + '.js' }));
new vm.Script(sw, { filename: 'sw.js' });

// Funções do chat ao vivo.
const src = html.slice(html.indexOf('  function chatRowsKey(rows)'), html.indexOf('  function bindChat(content, params, user, role) {'));
const scope = { global: {} };
vm.runInNewContext(src, scope);
const live = scope.global.QFChatLive;
const rows = [{ id: 'a', remetente_id: 'eu' }, { id: 'b', remetente_id: 'outro' }];
assert.equal(live.rowsKey([]), '0:');
assert.equal(live.rowsKey(rows), '2:b');
const seen = new Set();
assert.equal(live.incoming(seen, rows, 'eu'), 1, 'conta só a mensagem do outro');
assert.equal(live.incoming(seen, rows, 'eu'), 0, 'mesma lista não toca de novo');
assert.equal(live.incoming(seen, rows.concat([{ id: 'c', remetente_id: 'eu' }]), 'eu'), 0, 'minha própria mensagem não toca');
assert.equal(live.incoming(seen, rows.concat([{ id: 'c', remetente_id: 'eu' }, { id: 'd', remetente_id: 'outro' }]), 'eu'), 1);

// A conversa confere a cada 2 s, só com a tela visível, e avisa o servidor ao sair.
const chat = html.slice(html.indexOf('  function bindChat(content, params, user, role) {'), html.indexOf('  async function fillProfCompetition(content, params) {'));
assert.match(chat, /if \(!document\.hidden\) load\(false\);\s*\},2000\);/);
assert.match(chat, /Cloud\.chatLeave\(params\.id, profId\)/);
assert.match(chat, /if \(!ready\) list\.innerHTML/, 'falha passageira não apaga a conversa');
assert.match(html, /rpc\('qf_chat_sair'/);

// Push de mensagem da conversa aberta não vira notificação nem aviso por cima.
assert.match(sw, /if \(!inChat\) await self\.registration\.showNotification/);
assert.match(html, /dispatchEvent\(new CustomEvent\('qf-chat-refresh'\)\)/);

// Versões do app e do service worker andam juntas.
assert.equal(html.match(/const APP_VERSION = '([^']+)'/)[1], sw.match(/const SW_VERSION = '([^']+)'/)[1]);

// Regra do aviso único no banco.
assert.match(sql, /if not v_na_tela and not v_ja_avisado then/);
assert.match(sql, /grant execute on function public\.qf_chat_sair\(uuid,uuid\) to authenticated/);
console.log('chat ao vivo: ok');
