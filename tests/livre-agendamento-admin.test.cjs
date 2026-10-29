const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const chat=fs.readFileSync(path.join(__dirname,'../qf-chat-contratacao.js'),'utf8');
const admin=fs.readFileSync(path.join(__dirname,'../qf-comissao13.js'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261029223000_livre_agendamento_registrado_sem_cobranca_antecipada.sql'),'utf8');
test('chat Livre: propostas estruturadas com data e descrição e sem cobrança antecipada',()=>{
 new Function(chat);new Function(admin);
 assert.match(chat,/qf_livre_proposta_agendada/);
 assert.match(chat,/qf_livre_agendamento_ver/);
 assert.match(chat,/type="datetime-local"/);
 assert.match(chat,/name="descricao"/);
 assert.match(chat,/A proposta e o agendamento não geram cobrança/);
 assert.match(chat,/A conclusão ficará disponível após essa data/);
});
test('servidor exige origem do Plano Livre e autenticado para agendamentos',()=>{
 assert.match(migration,/auth\.uid\(\)<>p_profissional_id/);
 assert.match(migration,/d\.origem='comissao13'/);
 assert.match(migration,/revoke all on function public\.qf_livre_proposta_agendada.*from public,anon/);
 assert.match(migration,/grant execute on function public\.qf_livre_proposta_agendada.*to authenticated/);
 assert.match(migration,/p_agendado_em > now\(\)/);
 assert.match(migration,/servico_ainda_agendado/);
});
test('admin: agendamentos com aceite e conclusão, sem efetuar Pix ou saque',()=>{
 assert.match(admin,/function painelAgendamentos\(view,c\)/);
 assert.match(admin,/qf_livre_agendamentos_admin/);
 assert.match(admin,/Agendar não gera comissão nem Pix/);
});
