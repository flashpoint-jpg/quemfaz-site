const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const pix=fs.readFileSync(path.join(root,'supabase/migrations/20261029003001_qf_pix_validacao_manual.sql'),'utf8');
const manual=fs.readFileSync(path.join(root,'supabase/migrations/20261029003000_qf_repasses_manuais.sql'),'utf8');
const finance=fs.readFileSync(path.join(root,'qf-admin-financeiro.js'),'utf8');
const wallet=fs.readFileSync(path.join(root,'qf-comissao13.js'),'utf8');
const livre=fs.readFileSync(path.join(root,'qf-livre.js'),'utf8');
test('repasse manual não dispara Pix nem libera um pagamento não liquidado',()=>{
 assert.match(manual,/status<>'pago'/);
 assert.match(manual,/pago_em is null/);
 assert.match(manual,/estornado_centavos<>0/);
 assert.match(manual,/concluido_em is null/);
 assert.match(manual,/comissao_centavos<>v_comissao/);
 assert.match(manual,/profissional_centavos<>v_f.valor_centavos-v_comissao/);
 assert.match(manual,/not private\.qf_is_admin\(\)/);
 assert.match(manual,/revoke execute on function public\.qf_repasses_manuais_admin/);
 assert.match(manual,/unique references public\.qf_comissao13_financeiro/);
 assert.doesNotMatch(manual,/pix\.send|pix_send|curl|http_post/i);
});
test('profissional só solicita e o administrador apenas confirma após transferir pelo banco',()=>{
 assert.match(wallet,/qf_repasses_manuais_solicitar/);
 assert.match(wallet,/Solicitar pagamento/);
 assert.match(finance,/Confirmar transferência realizada/);
 assert.match(finance,/Fiz a transferência no banco/);
 assert.match(finance,/qf_repasses_manuais_admin/);
 assert.match(finance,/qf_repasses_manuais_painel/);
 assert.match(livre,/repasse não é automático|repasse será feito manualmente/i);
});
test('camada web preserva funcionalidades de pagamento já existentes',()=>{
 assert.match(wallet,/quemfaz-comissao13-pix/);
 assert.match(livre,/quemfaz-efi-checkout/);
 new Function(wallet);new Function(finance);new Function(livre);
});

test('validação de chave Pix exige administrador e evidência',()=>{
 assert.match(pix,/not private\.qf_is_admin\(\)/);
 assert.match(pix,/length\(trim\(p_evidencia\)\)/);
 assert.match(pix,/revoke execute on function public\.qf_repasses_validar_chave_admin/);
 assert.match(finance,/qf_repasses_validar_chave_admin/);
});
