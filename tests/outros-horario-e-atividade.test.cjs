// Pedido em "Outros": atividade escrita só entra se bater com o serviço do pedido; painel mostra "Fora do horário".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261017220000_outros_horario_e_atividade_do_pedido.sql'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');

// Quem marcou Outros continua valendo; atividade escrita só com palavra em comum com o serviço do pedido.
assert.ok(sql.includes("'cat_outros' = any(coalesce(p_especialidades"));
assert.ok(sql.includes('private.qf_tokens_servico(') && sql.includes('&&'));
// Destinatários do aviso e lista do painel usam a mesma regra; a antiga (qualquer atividade escrita) saiu.
assert.ok(sql.includes('on private.qf_pro_de_outros_do_pedido(pr.especialidades, c.categoria, c.titulo)'));
assert.equal(sql.split('private.qf_pro_de_outros_do_pedido(pr.especialidades, c.categoria, c.titulo)').length - 1, 3);
assert.ok(!sql.includes('private.qf_pro_de_outros(pr.especialidades)'));
// Regras do aviso preservadas: online, no horário, dentro do raio.
['pr.online is true', 'private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim)', 'private.qf_pro_atende_regiao(pr.user_id']
  .forEach((t) => assert.ok(sql.includes(t), t));
// Painel recebe no_horario por profissional.
assert.ok(sql.includes('private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim) as no_horario'));
// Funções novas fechadas para visitante.
['private.qf_tokens_servico(text)', 'private.qf_pro_de_outros_do_pedido(text[], text, text)', 'private.qf_outros_destinatarios(uuid)']
  .forEach((f) => assert.ok(sql.includes('revoke all on function ' + f + ' from public, anon, authenticated;'), f));
// Tela: online fora do horário não aparece como "Online".
assert.ok(admin.includes("p.no_horario === false ? '<span class=\"badge badge--muted\">Fora do horário</span>"));
assert.ok(admin.includes('fora do horário de atendimento'));
console.log('outros-horario-e-atividade ok');
