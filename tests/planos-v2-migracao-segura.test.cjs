const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261030183500_planos_visitas_v2_preparacao_inerte.sql'),'utf8');
test('novos planos são rascunhos, vendas e checkout desativados',()=>{
 assert.match(sql,/vendas_habilitadas boolean not null default false check\s*\(vendas_habilitadas=false\)/);
 assert.match(sql,/checkout_habilitado boolean not null default false check\(checkout_habilitado=false\)/);
 assert.match(sql,/status text not null default 'proposta'/);
});
test('nenhuma alteração em tabelas antigas nem exclusão de histórico',()=>{
 assert.doesNotMatch(sql,/\bdrop\s+table\b|\bdelete\s+from\b|\btruncate\b/i);
 assert.doesNotMatch(sql,/\bupdate\s+(?:public\.)?qf_(?:recargas|planos_profissional|livre_assinaturas|comissao13_)/i);
 assert.match(sql,/private\.qf_planos_v2_assinaturas/);
});
test('Pix de visita não pode ser considerado pago sem confirmação E2E',()=>{
 assert.match(sql,/qf_visita_paga_verificada/);
 assert.match(sql,/pago_em is not null and end_to_end_id is not null/);
 assert.match(sql,/habilitado boolean not null default false check\(habilitado=false\)/);
});
test('contagem da cota é única por desbloqueio e nunca autorizada pelo navegador',()=>{
 assert.match(sql,/desbloqueio_id uuid not null unique references public\.qf_desbloqueios/);
 assert.match(sql,/alter table private\.qf_planos_v2_consumos enable row level security/);
 assert.match(sql,/revoke all on private\.qf_planos_v2_config/);
});
