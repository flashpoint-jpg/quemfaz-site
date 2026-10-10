// V11.50 — plano pago ANTES de criar a conta do profissional + botões da foto separados.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-10-pagamento-antes-da-conta.sql'), 'utf8');
const fn = fs.readFileSync(path.join(root, 'supabase', 'functions', 'quemfaz-pre-cadastro', 'index.ts'), 'utf8');

[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'inline-' + i + '.js' }));
assert.equal(/const APP_VERSION = '([^']+)'/.exec(html)[1], /const SW_VERSION = '([^']+)'/.exec(sw)[1]);

// Foto: os dois botões ficam numa pilha com espaço (antes a classe não aplicava o espaçamento).
assert.ok(html.includes('class="card stack qf-cad-foto"') && html.includes('.qf-cad-foto{gap:14px}'));

// Plano pago: o envio do cadastro abre o pagamento e NÃO cria a conta.
const envio = html.slice(html.indexOf("const planoPago = QF_CAD_PLANOS.find"), html.indexOf("const foundCity = DB.cities()"));
assert.ok(envio.indexOf('abrirPagamento(dados, planoPago') > 0 && envio.indexOf('abrirPagamento(dados, planoPago') < envio.indexOf('criarContaAgora(dados, null, null)'));
// A conta só nasce depois do "aprovado"; em seguida o pagamento vira plano e os dados da conta aparecem.
const conf = html.slice(html.indexOf('async function pagamentoConfirmado()'), html.indexOf('function renderContaCriada(conta)'));
assert.ok(conf.indexOf("signUp('profissional', dados)") < conf.indexOf('preCadastroResgatar(pre.pag.id, pre.pag.segredo)'));
assert.ok(html.includes("if (r && r.ok && r.status === 'aprovado') { seguir = false; await pagamentoConfirmado(); return; }"));
assert.ok(html.includes('Dados da sua conta') && html.includes("<span>E-mail</span>") && html.includes("<span>Senha</span>") && html.includes('creditado na sua carteira'));
// A senha nunca vai para o armazenamento permanente do aparelho.
assert.ok(html.includes('const semSenha = Object.assign({}, dados); delete semSenha.senha;'));
// Formas de pagamento na tela e rede de segurança para quem pagou e entrou depois.
for (const m of ['pix', 'cartao', 'boleto']) assert.ok(html.includes("metodoBtn('" + m + "'"));
assert.ok(html.includes('global.QFPreCadastro.tentar()'));

// Banco: tabela fechada, resgate único e só de pagamento aprovado.
assert.ok(sql.includes('enable row level security') && sql.includes('revoke all on public.qf_pre_cadastro_pagamentos from anon, authenticated'));
assert.ok(sql.includes("if r.status <> 'aprovado' then") && sql.includes("'ja_usado'") && sql.includes('for update'));
// Servidor: confere e-mail antes de cobrar e só aprova com o valor batendo.
assert.ok(fn.includes('"email_em_uso"') && fn.indexOf('qf_pre_cadastro_email_livre') < fn.indexOf('await criarPix(row'));
assert.ok(fn.includes('esperado === original && pago >= esperado') && fn.includes('q.data.segredo !== segredo'));
console.log('pagamento-antes-da-conta ok');
// Avulso: conta na hora, com o aviso de que desbloquear chamado exige crédito na Carteira.
assert.ok(html.includes('Para desbloquear um chamado você precisa adicionar crédito na Carteira') && html.includes('data-plano-nota') && html.includes('No Avulso sua conta é criada agora.'));
