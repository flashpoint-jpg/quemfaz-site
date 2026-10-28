const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const sql=read('supabase/migrations/20261028043500_livre_pix_qualquer_banco.sql');
const cron=read('supabase/migrations/20261028043600_livre_pix_cron_repasses.sql');
const edge=read('supabase/functions/quemfaz-livre-pix/index.ts');
const pro=read('qf-livre.js');
const cliente=read('qf-acompanhamento.js');

test('profissional informa APENAS a chave Pix do banco atual',()=>{
 assert.match(pro,/Receba na conta que você já usa/);
 assert.match(pro,/Não precisa abrir conta Efí/);
 assert.match(pro,/qf_livre_pix_chaves/);
 assert.doesNotMatch(pro,/name="contaEfi"/);
 assert.match(sql,/p_chave_pix text/);
});
test('novo fluxo permanece desligado sem homologação de envio Pix',()=>{
 assert.match(sql,/habilitado boolean not null default false/);
 assert.match(sql,/homologado boolean not null default false/);
 assert.match(sql,/pix_send_aprovado boolean not null default false/);
 assert.match(cron,/habilitado and homologado and pix_send_aprovado/);
});
test('Pix de serviço só é criado com confirmação do cliente e débito antigo ausente',()=>{
 assert.match(sql,/f.cliente_concluiu_em is null/);
 assert.match(sql,/f.codigo_validado_em is null/);
 assert.match(sql,/d.origem='comissao13'/);
 assert.match(sql,/cobranca_anterior_existente/);
 assert.match(sql,/proprietario_hash=encode\(extensions.digest\(p_segredo/);
});
test('repasses usam apenas saldo de Pix recebido e ID do envio fixo',()=>{
 assert.match(edge,/gotIncoming\(incoming.data,b\)/);
 assert.match(edge,/qf_livre_pix_confirmar_entrada/);
 assert.match(edge,/\/v3\/gn\/pix\//);
 assert.match(edge,/\/v2\/gn\/pix\/enviados\/id-envio\//);
 assert.match(edge,/b.id_envio/);
 assert.match(edge,/idEnvio!==b.id_envio/);
 assert.match(edge,/sentVerified/);
 assert.match(read('supabase/functions/quemfaz-livre-pix/provas.mjs'),/status==='REALIZADO'/);
 assert.match(sql,/saida_e2eid text unique/);
});
test('titularidade é verificada pela Efí ao enviar, usando CPF/CNPJ',()=>{
 assert.match(edge,/cpf:b.documento/);
 assert.match(edge,/cnpj:b.documento/);
 assert.match(edge,/favorecido:fav/);
 assert.match(sql,/status='pendente'/);
 assert.match(sql,/validado_em is not null/);
});
test('o cliente vê pagamento e repasse como estados diferentes',()=>{
 assert.match(cliente,/quemfaz-livre-pix/);
 assert.match(cliente,/O Quem Faz recebeu seu Pix/);
 assert.match(cliente,/Transferência confirmada pelo banco/);
 assert.match(sql,/status='repassado'/);
 assert.match(sql,/qf_livre_pix_avisar/);
});
test('não existe liberação pública de confirmação bancária',()=>{
 assert.match(sql,/revoke all on function public.qf_livre_pix_confirmar_entrada\([^)]*\) from public,anon,authenticated/);
 assert.match(sql,/revoke all on function public.qf_livre_pix_confirmar_saida\([^)]*\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public.qf_livre_pix_confirmar_saida\([^)]*\) to service_role/);
});
