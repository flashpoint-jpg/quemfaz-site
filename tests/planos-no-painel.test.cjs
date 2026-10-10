// V11.55: preço dos planos vem do painel (qf_planos_catalogo) e o admin vê quem assinou ou tentou.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/2026-10-10-planos-no-painel.sql'), 'utf8');

// O app não tem mais preço de plano escrito à mão fora do ponto de partida de QFPlanos.
const semPadrao = html.replace(/const QFPlanos = global\.QFPlanos = [\s\S]*?\n  \}\)\(\);/, '');
assert.notStrictEqual(semPadrao, html, 'bloco QFPlanos não encontrado');
for (const fixo of ['R$ 49,90', 'R$ 99,90', 'R$ 199,90', '4990', '19990', 'R$ 4,99']) assert.ok(!semPadrao.includes(fixo), 'preço fixo no app: ' + fixo);
assert.ok(html.includes("client.from('qf_planos_catalogo').select('plano,preco_centavos,chamados,dias')"));

// QFPlanos faz as contas com o que vier do painel.
const bloco = /const QFPlanos = global\.QFPlanos = ([\s\S]*?\n  \}\)\(\));/.exec(html)[1];
const P = vm.runInNewContext(bloco);
assert.strictEqual(P.preco('mensal'), 'R$ 49,90');
assert.strictEqual(P.cada('mensal'), 'R$ 4,99');
assert.strictEqual(P.pct('mensal'), 61);
assert.strictEqual(P.aplicar([{ plano: 'mensal', preco_centavos: 5990, chamados: 12, dias: 45 }, { plano: 'outro', preco_centavos: 1, chamados: 1, dias: 1 }, { plano: 'pro', preco_centavos: 0, chamados: 25, dias: 30 }]), true);
assert.strictEqual(P.preco('mensal'), 'R$ 59,90');
assert.strictEqual(P.valor('mensal'), 5990);
assert.strictEqual(P.chamados('mensal'), 12);
assert.strictEqual(P.dias('mensal'), 45);
assert.strictEqual(P.cada('mensal'), 'R$ 4,99');
assert.strictEqual(P.preco('pro'), 'R$ 99,90', 'linha inválida não muda o plano');
assert.strictEqual(P.aplicar([{ plano: 'mensal', preco_centavos: 5990, chamados: 12, dias: 45 }]), false);
assert.strictEqual(P.aplicar(null), false);

// Painel: página, menu e chamadas ao banco.
assert.ok(admin.includes("{ pattern: '/admin/planos', role: 'admin', title: 'Planos dos profissionais', render: Screens.adminPlanosRender }"));
assert.ok(admin.includes("rpc('qf_admin_planos_painel')") && admin.includes("rpc('qf_admin_salvar_plano'"));
assert.ok(admin.includes('Quem assinou ou tentou assinar'));

// Banco: só admin salva; preço antigo ainda vira plano para quem já tinha gerado a cobrança.
assert.ok(/qf_admin_salvar_plano[\s\S]*?private\.qf_is_admin\(\)/.test(sql));
assert.ok(/qf_admin_planos_painel[\s\S]*?private\.qf_is_admin\(\)/.test(sql));
assert.ok(sql.includes('h.substituido_em >= new.criado_em'));
assert.ok(sql.includes('revoke all on public.qf_planos_catalogo_hist from anon, authenticated'));
console.log('planos-no-painel: ok');
