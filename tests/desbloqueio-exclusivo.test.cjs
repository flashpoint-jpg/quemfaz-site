// V11.90: no máximo 4 profissionais por pedido e desbloqueio exclusivo.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/2026-10-14-desbloqueio-exclusivo.sql'), 'utf8');

// Banco: limite de 4, exclusivo fecha o pedido (1 vaga), preço N× vindo da configuração, só sem ninguém dentro.
assert.ok(sql.includes('max_orcamentos <= 4'), 'check do banco em 4');
assert.ok(/least\(4,/.test(sql), 'limite nunca passa de 4');
assert.ok(/d\.exclusivo and coalesce\(d\.ativo, true\)\) then 1/.test(sql), 'exclusivo deixa 1 vaga');
assert.ok(sql.includes("'exclusivo_indisponivel'") && sql.includes('if v_participantes > 0 then'), 'exclusivo só sem ninguém');
assert.ok(sql.includes("v_preco_tabela * coalesce((v_excl->>'multiplicador')::numeric, 3)"), 'preço N×');
assert.ok(sql.includes('if not v_exclusivo then'), 'plano não cobre o exclusivo');
assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.qf_desbloquear_chamado(uuid, boolean) FROM PUBLIC, anon;'), 'sem acesso anônimo');

// App: opção exclusiva com a frase aprovada, e o pedido do cliente de 1 a 4.
assert.ok(html.includes('O contato fica reservado a 1 profissional verificado.'), 'frase do exclusivo');
assert.ok(html.includes('data-action="desbloquear-exclusivo"'), 'botão do exclusivo');
assert.ok(html.includes("{ p_chamado_id: chamadoId, p_exclusivo: true }"), 'chamada do exclusivo');
assert.ok(html.includes("client.rpc('qf_exclusivo_info')"), 'preço do exclusivo vem do painel');
assert.ok(html.includes('[1, 2, 3, 4].map(function (n) {'), 'cliente escolhe de 1 a 4');
assert.ok(!/\[1, 2, 3, 4, 5, 6, 7, 8\]/.test(html), 'sem opção acima de 4');
assert.ok(!/até 8 profissionais|Até 8 profissionais|até 8 Contatos/.test(html), 'sem texto de até 8');

// Painel: liga/desliga e multiplicador.
assert.ok(admin.includes("rpc('qf_admin_salvar_exclusivo'"), 'painel salva o exclusivo');
assert.ok(admin.includes("admExclusivoCarregar(content)"), 'painel carrega o exclusivo');
console.log('ok');
