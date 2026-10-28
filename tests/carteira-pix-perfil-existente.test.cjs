const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const js=fs.readFileSync(path.join(__dirname,'../qf-livre.js'),'utf8');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261028044500_chave_pix_perfil_existente.sql'),'utf8');
test('formulario Pix visivel para TODOS profissionais ja cadastrados na Carteira',()=>{
 const start=js.indexOf('async function mostrarContaPix(s){');
 const end=js.indexOf('function render(s){',start);
 const fn=js.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(fn,/pattern!=='\/profissional\/carteira'/);
 assert.doesNotMatch(fn,/!s\?\.ativo/);
 assert.match(fn,/Cadastre sua chave Pix/);
 assert.match(fn,/Não precisa abrir conta Efí/);
 assert.match(fn,/Salvar minha chave Pix/);
 assert.match(fn,/insertAdjacentElement\('afterend',area\)/);
 assert.match(js,/mostrarContaPix\(s\)\.catch/);
});
test('cadastro preserva conta existente e exige login do próprio profissional',()=>{
 assert.match(js,/client\.auth\.getUser\(\)/);
 assert.match(js,/eq\('profissional_id',userId\)/);
 assert.match(js,/onConflict:'profissional_id'/);
 assert.match(sql,/primary key references public\.qf_profissionais\(user_id\)/);
 assert.match(sql,/profissional_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/enable row level security/);
});
test('base Pix isolada e sem movimentação de dinheiro',()=>{
 assert.doesNotMatch(sql,/net\.http_post|efi|send\.pix|cron\.schedule|update public\.qf_chamados/i);
 assert.match(sql,/status='pendente'/);
 assert.match(js,/envio automático de dinheiro ainda não está liberado/);
});
test('nao exigir mais conta Efí na tela de cadastro de Pix',()=>{
 assert.doesNotMatch(js,/name="contaEfi"/);
 assert.doesNotMatch(js,/qf_livre_split_conta_cadastrar/);
 assert.match(js,/chave Pix do banco que já possui/);
});
