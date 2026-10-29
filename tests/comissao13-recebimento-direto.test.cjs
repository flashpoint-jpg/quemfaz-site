const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261029010400_qf13_recebimento_direto_bloqueio.sql'),'utf8');
const admin=fs.readFileSync(path.join(root,'supabase/migrations/20261029010401_qf13_recebimento_direto_admin.sql'),'utf8');
const ui=fs.readFileSync(path.join(root,'qf-comissao13.js'),'utf8');

test('recebimento direto exige conclusão, conta profissional e não cobra duas vezes',()=>{
  assert.match(sql,/profissional_id=v_uid FOR UPDATE/);
  assert.match(sql,/cliente_concluiu_em IS NULL/);
  assert.match(sql,/cliente_resposta IS DISTINCT FROM 'confirmado'/);
  assert.match(sql,/pagamento_plataforma_ja_confirmado/);
  assert.match(sql,/('preparando','pix_pronto','pago','repassado')/);
  assert.match(sql,/status='pendente'/);
  assert.match(sql,/comissao_vence_em=now\(\)/);
  assert.match(sql,/comissao_status|cobranca_status/);
});
test('bloqueio fica no servidor até Pix da comissão liquidar',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION private\.qf13_bloqueio/);
  assert.match(sql,/recebimento_direto_declarado_em IS NOT NULL/);
  assert.match(sql,/cobranca_status='pendente'/);
  assert.match(sql,/REVOKE EXECUTE ON FUNCTION private\.qf13_bloqueio/);
  assert.doesNotMatch(sql,/pix\.send|pix_send|http_post/i);
});
test('admin exige evidência e controle financeiro não abre Pix automático',()=>{
  assert.match(admin,/not private\.qf_is_admin\(\)/);
  assert.match(admin,/length\(trim\(coalesce\(p_evidencia/);
  assert.match(admin,/qf_comissao13_admin_declarar_direto/);
  assert.match(ui,/qf_comissao13_admin_declarar_direto/);
  assert.match(ui,/qf_comissao13_declarar_recebimento_direto/);
  assert.match(ui,/Registrar recebimento direto/);
  assert.match(ui,/Novos desbloqueios ficam suspensos/);
  new Function(ui);
});
