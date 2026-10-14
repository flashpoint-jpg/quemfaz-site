const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-14-voce-fechou.sql'), 'utf8');
const aviso = fs.readFileSync(path.join(root, 'supabase', 'functions', 'quemfaz-admin-aviso', 'index.ts'), 'utf8');

// Scripts continuam com sintaxe válida.
[html, admin].forEach((h, n) => [...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + n + '-' + i + '.js' })));
new vm.Script(sw, { filename: 'sw.js' });

// Versões casadas.
assert.equal(/const APP_VERSION = '([^']+)'/.exec(html)[1], /const SW_VERSION = '([^']+)'/.exec(sw)[1]);

// Banco: pergunta 3 horas depois, das 8h às 21h, no máximo duas vezes.
assert.ok(sql.includes("d.criado_em <= now() - interval '3 hours'"));
assert.ok(sql.includes("time '08:00'") && sql.includes("time '21:00'"));
assert.ok(sql.includes('fechou_pergunta2_em is null'));
assert.ok(sql.includes("'qf-perguntar-fechou', '*/5 * * * *'"));
// Responder pela notificação usa a mesma regra do botão do app (Fechei encerra o pedido).
assert.ok(sql.includes('public.qf_profissional_fechar_chamado(d.chamado_id'));
assert.ok(sql.includes('d.fechou_token is distinct from p_token'));

// Notificação: faixa leve com os botões e a chave da pergunta.
assert.ok(aviso.includes('fechou_token'));
assert.ok(sw.includes("{ action: 'fechei', title: 'Fechei' }"));
assert.ok(sw.includes("{ action: 'nao_fechei', title: 'Não fechei' }"));
assert.ok(sw.includes('qf_fechou_responder_token'));

// App do profissional: pergunta clara e "Ainda estou conversando".
assert.ok(html.includes('Você fechou o serviço com esse cliente?'));
assert.ok(html.includes('data-action="ainda-conversando"'));
assert.ok(html.includes("client.rpc('qf_fechou_conversando'"));
assert.ok(html.includes('Falta sua resposta: você fechou o serviço?'));

// Painel: aba própria no menu lateral, atualiza sozinha.
assert.ok(admin.includes("{ id: 'fechou', label: 'Fechou? · sem resposta'"));
assert.ok(admin.includes("pattern: '/admin/fechou'"));
assert.ok(admin.includes("rpc('qf_admin_fechou_respostas')"));
assert.ok(admin.includes("if (fc && fc.parentNode) admFechouCarregar(fc.parentNode);"));
