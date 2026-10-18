const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../docs/seo-public-consent-proposal.sql'),'utf8');
test('consentimento privado por padrão',()=>{
 assert.match(sql,/autorizado boolean not null default false/i);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on public\.qf_seo_consentimentos from public, anon/i);
 assert.doesNotMatch(sql,/grant\s+select[^;]*\bto\s+anon\b/i);
});
test('RLS restringe leitura e atualização ao titular',()=>{
 assert.match(sql,/for select to authenticated using \(profissional_id = \(select auth\.uid\(\)\)\)/i);
 assert.match(sql,/for update to authenticated using \(profissional_id = \(select auth\.uid\(\)\)\)/i);
 assert.match(sql,/with check \(profissional_id = \(select auth\.uid\(\)\)\)/i);
});
test('nenhuma migração financeira',()=>{
 assert.doesNotMatch(sql,/\b(?:alter|drop|truncate|update|delete)\s+(?:table\s+)?(?:public\.)?qf_(?:recargas|pagamentos|carteira|chamados)\b/i);
});
