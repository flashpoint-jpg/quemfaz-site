// Pedido sem profissional em "Outros": aviso automático só para quem tem Outros/atividade escrita, online e perto.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261017190000_alerta_pedido_outros_sem_profissional.sql'), 'utf8');

// Destinatários: só "Outros" ou atividade escrita no cadastro.
assert.ok(sql.includes("'cat_outros' = any(coalesce(pr.especialidades"));
assert.ok(sql.includes("e like 'cat\\_custom\\_%'"));
// Pedido: só cat_outros ou serviço digitado, aberto.
assert.ok(sql.includes("(c.categoria = 'cat_outros' or c.categoria like 'cat\\_custom\\_%')"));
// Online, no horário, dentro do raio do profissional, sem pendência e sem ser o cliente.
['pr.online is true', 'private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim)', 'private.qf_pro_atende_regiao(pr.user_id',
 "private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null", 'pr.user_id <> c.cliente_id'
].forEach((t) => assert.ok(sql.includes(t), t));
// Só vale se ninguém cadastrado nesse serviço atende; uma vez por pedido.
assert.ok(sql.includes('new.categoria = any(p.especialidades)'));
assert.ok(sql.includes("a.tipo = 'pedido_outros'"));
// Aviso leve (sem toque de chamado), levando para a aba Outros pedidos.
assert.ok(sql.includes("'/profissional/outros-pedidos'") && sql.includes("'action', 'user_notice'"));
assert.ok(!sql.includes('new_call'));
// Dispara no pedido novo e quando passa a aberto; funções fechadas para visitante.
assert.ok(sql.includes('after insert on public.qf_chamados') && sql.includes('after update of status on public.qf_chamados'));
['private.qf_outros_destinatarios(uuid)', 'private.qf_outros_alertar(uuid)', 'private.qf_chamado_outros_alertar_trg()']
  .forEach((f) => assert.ok(sql.includes('revoke all on function ' + f + ' from public, anon, authenticated;'), f));
console.log('alerta-pedido-outros ok');
