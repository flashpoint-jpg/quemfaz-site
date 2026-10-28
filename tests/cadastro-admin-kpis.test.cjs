const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const front=fs.readFileSync('qf-admin-cadastro-pago.js','utf8');
const admin=fs.readFileSync('admin.html','utf8');
const migration=fs.readFileSync('supabase/2026-10-28-cadastro-pagante-kpis.sql','utf8');
test('Card administrativo carrega RPC protegida sem contadores ficticios',()=>{
 new vm.Script(front,{filename:'qf-admin-cadastro-pago.js'});
 assert.match(admin,/qf-admin-cadastro-pago\.js\?v=20261028-kpi-real/);
 assert.match(front,/\.rpc\('qf_admin_cadastro_pagamentos'\)/);
 assert.match(front,/data-qf-admin-paid-refresh/);
 assert.match(front,/saldo antecipado do profissional não é receita reconhecida/);
});
test('Servidor exige admin e diferencia saldo, pagamentos e assinaturas',()=>{
 assert.match(migration,/not private\.qf_is_admin\(\)/i);
 for(const k of ['pre_cadastros_pendentes','pre_cadastros_abandonados','pagos_ainda_nao_resgatados',
 'profissionais_ativos','avulsos_iniciais_pagos','livres_iniciais_pagos','livres_vigentes','livres_vencidos',
 'recebido_avulso_inicial_centavos','recebido_livre_inicial_centavos','saldo_carteiras_total_centavos'])
  assert.ok(migration.includes("'"+k+"'"),k);
 assert.ok(!migration.includes("'receita_efetiva'"),'Nao confundir saldos com receita');
});
