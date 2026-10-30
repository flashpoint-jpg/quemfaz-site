const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const html=read('index.html');
const edge=read('supabase/functions/quemfaz-pre-cadastro/index.ts');
const sql=read('supabase/migrations/20261030221000_documento_unico_antes_do_pix.sql');

test('CPF/CNPJ é enviado à pré-verificação bancária e não depende de localStorage',()=>{
 assert.match(html,/tipo_documento: pessoa\.cnpj \? 'cnpj' : 'cpf'/);
 assert.match(html,/documento: pessoa\.cnpj \|\| pessoa\.cpf \|\| ''/);
 assert.match(html,/cpf: pre\.dados\.cpf \|\| '', cnpj: pre\.dados\.cnpj \|\| ''/);
 assert.match(html,/const reusa = .*antigo\.dados/);
 assert.match(html,/antigo\.dados\.cpf \|\| antigo\.dados\.cnpj/);
 assert.match(html,/documento_ja_cadastrado/);
 assert.match(html,/documento_cobranca_existente/);
 assert.match(html,/telefone_ja_cadastrado/);
});
test('Edge exige documento antes de qualquer Pix e não guarda documento em claro',()=>{
 const start=edge.indexOf('if (acao === "criar")');
 const check=edge.indexOf('qf_pre_cadastro_documento_elegivel',start);
 const money=edge.indexOf('criarPix(row',check);
 assert.ok(start>=0 && check>start && money>check);
 assert.match(edge,/documento_obrigatorio/);
 assert.match(edge,/documentoHash = String\(identidade\.data\.documento_hash/);
 assert.match(edge,/documento_tipo: tipoDocumento, documento_hash: documentoHash, documento_final: documentoFinal/);
 assert.doesNotMatch(edge,/segredo, email, nome: nome \|\| null, telefone: telefone \|\| null,[\s\S]{0,120}documento: documento/);
 assert.match(edge,/ins\.error\?\.code === "23505"/);
 assert.match(edge,/replace\(\/\^55\(\?=\\d\{10,11\}\$\)\/,""\)/);
});
test('banco garante CPF/CNPJ e telefone únicos em cobranças pendentes ou pagas',()=>{
 assert.match(sql,/create unique index if not exists qf_pre_cadastro_um_documento_por_pagamento_ativo/);
 assert.match(sql,/create unique index if not exists qf_pre_cadastro_um_telefone_por_pagamento_ativo/);
 assert.match(sql,/status in \('pendente','aprovado'\)/);
 assert.match(sql,/private\.qf_identidades i/);
 assert.match(sql,/telefone_ja_cadastrado/);
 assert.match(sql,/documento_ja_cadastrado/);
 assert.match(sql,/to service_role;/);
 assert.match(sql,/revoke all on function public\.qf_pre_cadastro_documento_elegivel/);
});
test('gatilho do Auth vincula a identidade antes de ativar perfil profissional',()=>{
 const identity=sql.indexOf('insert into private.qf_identidades');
 const profile=sql.indexOf('insert into public.qf_profiles',identity);
 assert.ok(identity>=0 && profile>identity);
 assert.match(sql,/values\(new\.id,v_pago\.documento_hash,v_pago\.documento_final,now\(\)\)/);
 assert.match(sql,/v_pago\.documento_tipo='cpf'/);
 assert.match(sql,/v_pago\.documento_tipo='cnpj'/);
 assert.doesNotMatch(sql,/drop table.*qf_identidades/i);
});
test('CNPJ alfanumérico 2026 e numérico seguem regra de dígitos verificadores',()=>{
 const begin=html.indexOf('  function formatCnpj(v) {');
 const end=html.indexOf('  function ufOptions(',begin);
 assert.ok(begin>=0 && end>begin && end-begin<3000);
 const context={};
 vm.runInNewContext(html.slice(begin,end)+'\nthis.cnpj={formatCnpj,validCnpj};',context);
 assert.equal(context.cnpj.validCnpj('00.000.000/E08G-12'),true);
 assert.equal(context.cnpj.validCnpj('00.000.000/E08G-13'),false);
 assert.equal(context.cnpj.formatCnpj('00000000e08g12'),'00.000.000/E08G-12');
 assert.equal(context.cnpj.validCnpj('00.000.000/0000-00'),false);
 assert.match(sql,/create or replace function private\.qf_cnpj_valido/);
 assert.match(sql,/ascii\(substr\(v,i,1\)\)-48/);
});
