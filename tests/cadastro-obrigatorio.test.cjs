// Cadastro pago: regressão estrutural, sem cobrar nem ativar dinheiro real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const livre=fs.readFileSync(path.join(root,'qf-livre.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/2026-10-28-cadastro-pago-obrigatorio.sql'),'utf8');
const edge=fs.readFileSync(path.join(root,'supabase/functions/quemfaz-pre-cadastro/index.ts'),'utf8');
const signup=html.slice(html.indexOf("form.addEventListener('submit', async function (e) {",680000));

test('Scripts inline e modulo Livre com sintaxe valida',()=>{
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m,i)=>new vm.Script(m[1],{filename:'inline-'+i+'.js'}));
  new vm.Script(livre,{filename:'qf-livre.js'});
});
test('Apenas dois planos iniciais, com valores exatos',()=>{
  const block=html.slice(html.indexOf('const QF_CAD_PLANOS = ['),html.indexOf('global.QFCadPlanos = QF_CAD_PLANOS;'));
  assert.match(block,/id: 'avulso'.*valor: 1300/);
  assert.match(block,/id: 'livre'.*valor: 3990/);
  assert.doesNotMatch(block,/id: '(mensal|premium|pro)'/);
  assert.doesNotMatch(block,/Conta criada na hora, sem pagar nada agora/);
  assert.match(block,/Os R\$ 13 viram saldo integral/);
});
test('Nao ha criacao de profissional antes do checkout, nem fallback offline',()=>{
  assert.match(signup,/abrirPagamento\(dados, planoPago/);
  assert.doesNotMatch(signup,/criarContaAgora\(dados, livreEscolhido/);
  assert.doesNotMatch(signup,/DB\.cadastrarProfissional\(dados\)/);
  assert.doesNotMatch(html,/data-plano-depois>Prefiro escolher depois/);
});
test('Pagamento no backend e vinculo antes da insercao do perfil',()=>{
  const ensure=html.slice(html.indexOf('async function ensureProfile('),html.indexOf('async function syncLocalUser('));
  assert.ok(ensure.indexOf("client.rpc('qf_vincular_pre_cadastro'")<ensure.indexOf("client.from('qf_profiles').insert("));
  assert.match(ensure,/Pagamento não confirmado para este e-mail/);
  assert.match(html,/r\.status === 'aprovado'\) \{ seguir = false; await pagamentoConfirmado/);
});
test('Nenhum boleto ou cartao Livre como atalho de conta',()=>{
  assert.doesNotMatch(html,/metodoBtn\('boleto'/);
  assert.match(html,/pre\.plano === 'avulso' \? metodoBtn\('cartao'/);
  assert.match(html,/metodo !== 'pix' && !\(metodo === 'cartao' && pre\.plano === 'avulso'\)/);
});
test('Plano Livre exibido uma so vez',()=>{
  assert.doesNotMatch(livre,/group\.insertAdjacentHTML\('afterbegin'/);
  assert.doesNotMatch(livre,/QFCadPlanos\)\)g\.QFCadPlanos\.splice\(1\)/);
});
test('Banco: RLS gatilhos e resgate transacional idempotente',()=>{
  assert.match(sql,/trg_qf_cadastro_profissional_pago_perfil/);
  assert.match(sql,/trg_qf_cadastro_profissional_pago\b/);
  assert.match(sql,/qf_vincular_pre_cadastro/);
  assert.match(sql,/p\.status='aprovado'/);
  assert.match(sql,/email_confirmed_at IS NOT NULL/);
  assert.match(sql,/v_vinculo IS DISTINCT FROM r\.id/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/r\.profissional_id=v_uid AND r\.recarga_id IS NOT NULL/);
});
test('Banco: Avulso vira 1300 centavos de saldo e Livre nao recebe recarga extra',()=>{
  assert.match(sql,/CASE WHEN r\.plano='avulso' THEN NULL ELSE r\.plano END/);
  assert.match(sql,/m\.valor_centavos=1300/);
  assert.match(sql,/r\.plano='livre' AND r\.valor_centavos=3990 AND r\.metodo='pix'/);
});
test('Profissionais existentes preservados, sem criacao de pagamentos ou repasses',()=>{
  assert.match(sql,/qf_profissionais_anteriores_pagamento/);
  assert.match(sql,/INSERT INTO private\.qf_profissionais_anteriores_pagamento/);
  assert.doesNotMatch(sql,/INSERT INTO public\.qf_pre_cadastro_pagamentos/);
  assert.doesNotMatch(sql,/qf_livre_split_confirmar_banco/);
});

test('Efí recusa planos legados, preço divergente e cartão Livre ANTES de cobrar',()=>{
 const inicio=edge.indexOf('if (acao === "criar")');
 const gerar=edge.indexOf('const segredo = segredoNovo()',inicio);
 const trecho=edge.slice(inicio,gerar);
 assert.match(trecho,/plano !== "avulso" && plano !== "livre"/);
 assert.match(trecho,/plano === "livre" && metodo !== "pix"/);
 assert.match(trecho,/valorEsperado = plano === "avulso" \? 1300 : 3990/);
 assert.match(sql,/ADD CONSTRAINT qf_cadastro_preco_valido/);
});
