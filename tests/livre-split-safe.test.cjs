const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const p=require('node:path');
const read=x=>fs.readFileSync(p.join(__dirname,'..',x),'utf8');
const base=read('supabase/migrations/20261028042000_livre_split_pos_servico.sql');
const bank=read('supabase/functions/quemfaz-livre-split/index.ts');
const receiver=read('supabase/migrations/20261028042300_livre_conta_pix_profissional.sql');
const history=read('supabase/migrations/20261028042500_livre_split_elegibilidade_desbloqueio.sql');
const sync=read('supabase/migrations/20261028042400_livre_split_sync_minuto.sql');
const alert=read('supabase/migrations/20261028042200_livre_split_avisos_idempotentes.sql');
const customer=read('qf-acompanhamento.js');
const professional=read('qf-livre.js');
test('split começa DESLIGADO e precisa de homologação bancária',()=>{
 assert.match(base,/habilitado boolean not null default false/);
 assert.match(base,/homologado boolean not null default false/);
 assert.match(base,/habilitado and homologado/);
 assert.match(sync,/habilitado/);
 assert.match(sync,/vault.decrypted_secrets/);
});
test('Pix somente após conclusão confirmada, segredo do pedido e desbloqueio Livre',()=>{
 assert.match(base,/proprietario_hash=encode\(extensions.digest\(p_segredo/);
 assert.match(base,/f.codigo_validado_em is null/);
 assert.match(base,/f.cliente_concluiu_em is null/);
 assert.match(history,/d.origem='comissao13'/);
 assert.match(base,/cobranca_antiga_existente/);
});
test('split Efí exige conta validada e vincula ANTES de expor o QR',()=>{
 assert.match(receiver,/status='pendente'/);
 assert.match(receiver,/status='validado'/);
 assert.match(receiver,/private.qf_is_admin\(\)/);
 assert.match(bank,/valor:"13.00"/);
 assert.match(bank,/valor:"87.00"/);
 assert.match(bank,/\/v2\/gn\/split\/cob\//);
 assert.match(bank,/vinculo/);
 assert.match(bank,/if\(!cob.ok\|\|!validSplit\(cob.data,entry\)\)/);
 assert.match(bank,/qf_livre_split_marcar_qr/);
});
test('conciliação exige comprovante E2E, valor, split e repasse',()=>{
 assert.match(base,/p_end_to_end_id/);
 assert.match(base,/p_split_id/);
 assert.match(base,/p_repasse_creditado/);
 assert.match(bank,/recipientCredit\(bank.data,entry\)/);
 assert.match(bank,/platformCredit\(bank.data,entry\)/);
 assert.match(bank,/dataEfetivacao/);
 assert.match(alert,/primary key\(pagamento_id,tipo\)/);
 assert.match(alert,/qf_push_interno\('chat_message'/);
});
test('somente Plano Livre mostra opção de Pix e conta Efí, sem habilitar Avulso',()=>{
 assert.match(customer,/data-qf-livre-split/);
 assert.match(customer,/cliente_concluiu_em/);
 assert.match(customer,/!d.disponivel&&d.status==='nao_iniciado'/);
 assert.match(professional,/qf_livre_split_conta_cadastrar/);
 assert.match(professional,/conta digital Efí/);
 assert.match(professional,/novo pagamento pós-serviço/);
});
test('funções financeiras internas inacessíveis a cliente e profissional',()=>{
 assert.match(base,/revoke all on function public.qf_livre_split_confirmar_banco/);
 assert.match(base,/grant execute on function public.qf_livre_split_confirmar_banco\([^\n]+\) to service_role/);
 assert.match(receiver,/validado_em=null/);
 assert.match(bank,/req.headers.get\("x-qf-internal"\)/);
});
