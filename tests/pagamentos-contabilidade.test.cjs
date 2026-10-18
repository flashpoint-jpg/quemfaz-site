'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mig = read('supabase/migrations/20261018190000_pagamentos_auditoria_contabilidade.sql');
const index = read('index.html');
const admin = read('admin.html');

test('migração: plano nunca vira saldo e a entrega é idempotente', () => {
  assert.match(mig, /plano_nao_resolvido/);
  assert.match(mig, /for update/i);
  assert.match(mig, /qf_mov_bonus_recarga_unico/);
  assert.match(mig, /exception\s+when others/i);
  assert.match(mig, /erro_beneficio/);
});

test('migração: RPCs administrativas protegidas', () => {
  for (const fn of ['qf_admin_contabilidade', 'qf_admin_pagamento_eventos', 'qf_admin_reconciliar_recargas']) {
    assert.match(mig, new RegExp('revoke execute on function public\\.' + fn + '[^;]*from[^;]*anon', 'i'), fn);
    assert.match(mig, new RegExp('grant execute on function public\\.' + fn + '[^;]*to authenticated', 'i'), fn);
  }
  assert.match(mig, /qf_is_admin\(\)/);
  assert.match(mig, /qf_pagamento_eventos[\s\S]*enable row level security/i);
});

test('migração: ajuste manual negativo vira débito e não negativa o saldo', () => {
  assert.match(mig, /saldo_insuficiente/);
  assert.match(mig, /ajuste_manual/);
});

test('app do profissional: carteira e planos separados', () => {
  assert.match(index, /if \(r\.plano\) return;/);
  assert.match(index, /Minha carteira/);
  assert.match(index, /Meus planos/);
  assert.match(index, /Recarregar/);
  assert.match(index, /Histórico de créditos e débitos/);
  for (const s of ['Ativo', 'Expirado', 'Chamados esgotados', 'Pago · plano ativado', 'Aguardando pagamento']) {
    assert.ok(index.includes(s), s);
  }
});

test('admin: contabilidade separa dinheiro, créditos consumidos e planos', () => {
  assert.match(admin, /qf_admin_contabilidade/);
  assert.ok(admin.includes('Dinheiro recebido'));
  assert.ok(admin.includes('Créditos consumidos'));
  assert.ok(admin.includes('Uso de planos'));
  assert.ok(admin.includes('Entregar agora'));
});

test('banco: cenários de pagamento passam no Postgres isolado (opcional)', { skip: !process.env.QF_TEST_PG }, () => {
  const r = spawnSync('bash', [path.join(root, 'tests/pagamentos-db.sh')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PAGAMENTOS-DB: OK/);
});
