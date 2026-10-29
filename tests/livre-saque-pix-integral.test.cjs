const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const main=fs.readFileSync(path.join(__dirname,'../qf-comissao13.js'),'utf8');
const ledger=fs.readFileSync(path.join(__dirname,'../qf-pix-financeiro.js'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029225100_livre_pix_solicitacao_saque_manual.sql'),'utf8');
const adminMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029225600_livre_pix_ledger_saque_solicitado.sql'),'utf8');
const notify=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029225900_livre_pix_notificar_pagamento_confirmado.sql'),'utf8');
test('saque é solicitado apenas depois do pagamento bancário conciliado',()=>{
 new Function(main);new Function(ledger);
 assert.match(migration,/v\.status<>'pago'/);
 assert.match(migration,/v\.confirmado_em is null or v\.end_to_end_id is null/);
 assert.match(migration,/v\.profissional_id is distinct from auth\.uid\(\)/);
 assert.match(migration,/v\.saque_solicitado_em is not null/);
});
test('repasse exige saque solicitado, comprovante e administrador',()=>{
 assert.match(migration,/v\.saque_solicitado_em is null/);
 assert.match(migration,/private\.qf_is_admin\(\)/);
 assert.match(migration,/length\(trim\(coalesce\(p_comprovante/);
 assert.match(main,/qf_livre_manual_pix_solicitar/);
 assert.match(ledger,/!r\.saque_solicitado_em/);
 assert.match(adminMigration,/v\.saque_solicitado_em/);
});
test('confirmação bancária notifica uma vez, sem transferência automática',()=>{
 assert.match(notify,/qf_livre_manual_pix_liquidar/);
 assert.match(notify,/if v.status in \('pago','repassado'\)/);
 assert.match(notify,/qf_push_interno\('chat_message'/);
 assert.doesNotMatch(notify,/(pixEnviar|transferenciaAutomatica|split_bank)/i);
});
