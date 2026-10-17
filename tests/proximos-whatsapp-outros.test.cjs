// Painel "Profissionais próximos ao pedido": pedido em Outros lista quem tem Outros e o WhatsApp sai com o link do pedido.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261017194500_painel_proximos_outros.sql'), 'utf8');

// Banco: lista e contagem usam o grupo de Outros só quando o pedido é de Outros e ninguém atende o serviço.
assert.ok(sql.includes('private.qf_pedido_outros_sem_profissional(c.id)'));
assert.ok(sql.includes("'outros', o.sem"));
assert.ok(sql.includes('(o.sem and private.qf_pro_de_outros(pr.especialidades))'));
assert.ok(sql.includes('private.qf_outros_destinatarios(c.id)'));
assert.ok(sql.includes("a.tipo = 'pedido_outros'"));
assert.ok(sql.includes("v_rota := '/profissional/outros-pedidos'"));
assert.ok(sql.includes('revoke all on function private.qf_pedido_outros_sem_profissional(uuid) from public, anon, authenticated;'));

// Painel: mensagem pronta do WhatsApp, rodada isolada.
const a = html.indexOf('  function admProximosMensagemWa(c, p) {');
const b = html.indexOf('  function admProximosHtml(d) {');
assert.ok(a > 0 && b > a);
const ctx = {};
vm.runInNewContext(html.slice(a, b) + '\nthis.f = admProximosMensagemWa;', ctx);
const msg = ctx.f({ id: 'abc-123', titulo: 'Entulho', bairro: 'Macuco', cidade: 'Santos', uf: 'SP' }, { nome: 'Robson Aurelio' });
assert.equal(msg, 'Olá, Robson! Aqui é do QuemFaz. Chegou um pedido de "Entulho" em Macuco, Santos/SP. Se você atende, veja e aceite por aqui: https://quemfazservico.com.br/#/profissional/chamada/abc-123');
assert.ok(ctx.f({ id: 'x' }, {}).startsWith('Olá! Aqui é do QuemFaz. Chegou um pedido de "serviço".'));
assert.ok(html.includes("waHref(p.telefone) + '?text=' + encodeURIComponent(admProximosMensagemWa(c, p))"));
assert.ok(html.includes("outros ? 'Somente profissionais de Outros ou com atividade escrita'"));
console.log('proximos-whatsapp-outros ok');
