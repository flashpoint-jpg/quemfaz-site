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

// V11.57: ativar/trocar/tirar o plano na mão e gerar o Pix do plano pelo painel.
{
  const sql2 = fs.readFileSync(path.join(root, 'supabase/2026-10-10-plano-manual-e-pix-pelo-painel.sql'), 'utf8');
  const fn = fs.readFileSync(path.join(root, 'supabase/functions/quemfaz-admin-pix/index.ts'), 'utf8');
  for (const nome of ['qf_admin_ativar_plano', 'qf_admin_remover_plano']) assert.ok(new RegExp(nome + '[\\s\\S]*?private\\.qf_is_admin\\(\\)').test(sql2), nome);
  // Criar a recarga do plano para outra pessoa: só o servidor, e só com um admin de verdade.
  assert.ok(sql2.includes('revoke all on function public.qf_admin_recarga_plano_criar(uuid, uuid, text) from public, anon, authenticated'));
  assert.ok(sql2.includes('exists (select 1 from public.qf_admins a where a.user_id = p_admin)'));
  assert.ok(fn.includes('from("qf_admins").select("user_id").eq("user_id", u.user.id)') && fn.indexOf('"forbidden"') < fn.indexOf('qf_admin_recarga_plano_criar'));
  assert.ok(fn.includes('"qf:recarga:" + recargaId'), 'o Pix do painel é conferido como recarga');
  assert.ok(admin.includes("functions.invoke('quemfaz-admin-pix'") && admin.includes("rpc('qf_admin_ativar_plano'") && admin.includes("rpc('qf_admin_remover_plano'"));
  const acoes = admin.slice(admin.indexOf("const b = t.closest('[data-plano-acao]');"), admin.indexOf('function admPlanoLer(f)'));
  assert.ok(acoes.indexOf('await PU.confirmDialog(') > 0 && acoes.indexOf('await PU.confirmDialog(') < acoes.indexOf("functions.invoke('quemfaz-admin-pix'"), 'confirma antes de agir');
  console.log('plano manual e pix pelo painel: ok');
}
