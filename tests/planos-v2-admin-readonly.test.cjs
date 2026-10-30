const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261030184000_planos_ativos_v2_admin_leitura.sql'),'utf8');

test('painel v2 consulta somente admin, com definer e escopo seguro',()=>{
 assert.match(source,/if not private\.qf_is_admin\(\)/);
 assert.match(source,/security definer set search_path to ''/);
 assert.match(source,/revoke all on function public\.qf_admin_planos_ativos_v2\(\)/);
});
test('consulta reúne plano antigo e novo, com pagamento e vencimento',()=>{
 assert.match(source,/from public\.qf_livre_assinaturas/);
 assert.match(source,/from public\.qf_planos_profissional/);
 assert.match(source,/from private\.qf_planos_v2_assinaturas/);
 assert.match(source,/r\.status='aprovado'/);
 assert.match(source,/vence_em_7_dias/);
});
test('painel v2 não movimenta saldo e não permite ativar plano',()=>{
 assert.doesNotMatch(source,/\bupdate\s+public\.|\bdelete\s+from\b|\binsert\s+into\b|\btruncate\b/i);
});
