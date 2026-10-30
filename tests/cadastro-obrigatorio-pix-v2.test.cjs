const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const edge=fs.readFileSync(path.join(base,'supabase/functions/quemfaz-pre-cadastro/index.ts'),'utf8');
const sql=fs.readFileSync(path.join(base,'supabase/migrations/20261030192000_cadastro_profissional_exigir_pix_no_auth.sql'),'utf8');

test('formulário não oferece teste grátis nem cortesia e não cria profissional pelo atalho',()=>{
 const start=html.indexOf('function cadastroProfissionalView()');
 const end=html.indexOf('function validPhone(',start);
 const form=html.slice(start,end);
 assert.ok(start>=0&&end>start);
 assert.doesNotMatch(form,/name="testeLivre"|name="cortesiaLivre"/);
 const submit=html.slice(html.indexOf("form.addEventListener('submit', async function (e) {",html.indexOf('function cadastroProfissionalView()')),html.indexOf('/* QuemFaz — telas da área Cliente */'));
 assert.doesNotMatch(submit,/fd\.get\('testeLivre'\)|fd\.get\('cortesiaLivre'\)/);
 assert.match(submit,/abrirPagamento\(dados, planoPago, fd\.get\('indicacao'\)\)/);
});
test('backend do cadastro profissional exige Pix Efí validado no usuário autenticado',()=>{
 assert.match(sql,/new\.raw_user_meta_data->>'qf_pre_cadastro_id'/);
 assert.match(sql,/new\.raw_user_meta_data->>'qf_pre_cadastro_segredo'/);
 assert.match(sql,/v_pago\.status<>'aprovado'/);
 assert.match(sql,/v_pago\.provedor<>'efi'/);
 assert.match(sql,/lower\(trim\(v_pago\.email\)\) is distinct from lower\(trim\(new\.email\)\)/);
 assert.match(sql,/v_pago\.metodo<>'pix'/);
 assert.match(sql,/insert into private\.qf_cadastro_pagamento_vinculo\(user_id,pagamento_id\)/);
 assert.match(sql,/select private\.qf_cadastro_pagamento_original_ok\(p_uid\)/);
 assert.match(sql,/revoke all on function public\.qf_livre_preparar_acesso/);
});
test('o signup passa o comprovante ao banco e exige confirmação novamente antes da conta',()=>{
 assert.match(html,/qf_pre_cadastro_id:prePagoMeta\.id/);
 assert.match(html,/qf_pre_cadastro_segredo:prePagoMeta\.segredo/);
 assert.match(html,/if \(!prePagoMeta\) return \{ok:false,error:/);
 assert.match(html,/aprova(cao|ção)[\s\S]{0,300}status === 'aprovado'/);
 assert.match(html,/É necessário pagar o plano escolhido para concluir seu cadastro\./);
});
test('o checkout para novos cadastros aceita somente Pix',()=>{
 assert.match(edge,/if \(metodo !== "pix"\) return json/);
 assert.match(html,/if \(metodo !== 'pix'\) return;/);
 assert.doesNotMatch(html.slice(html.indexOf('function renderEscolha(aviso)'),html.indexOf('function renderAguardando()')),/metodoBtn\('cartao'/);
});
