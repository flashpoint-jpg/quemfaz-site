const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const ler=p=>fs.readFileSync(path.join(root,p),'utf8');
const visita=require('../qf-visita.js');
const form=ler('qf-atendimento.js'),index=ler('index.html'),admin=ler('qf-admin-financeiro.js'),
 db=ler('supabase/migrations/20261030205000_visita_presencial_opcional_pix_manual.sql'),
 checkout=ler('supabase/functions/quemfaz-efi-checkout/index.ts');

test('arquivo da visita e formulário executam sintaxe JavaScript válida',()=>{
 new vm.Script(ler('qf-visita.js'));
 new vm.Script(form);
 new vm.Script(admin);
});
test('cliente escolhe sim ou não para orçamento presencial R$25 na etapa de condições',()=>{
 assert.match(form,/\['Condições',\['materiais'\]\]/);
 assert.match(form,/Deseja orçamento presencial \(opcional\)\?/);\n assert.match(form,/data-qf-visita-escolha/);
 assert.match(form,/value="nao"/);
 assert.match(form,/value="sim"/);
 assert.match(form,/visita_presencial:a\.visita_presencial\|\|'nao'/);
 assert.match(form,/a\.visita_presencial==='sim'/);
 assert.match(form,/root\.QFVisita\.abrir\(\{id:req\.id\}\)/);
});
test('profissional só vê selo de visita paga quando confirmação real foi carregada',()=>{
 const p=visita.selo({id:'id',visitaPresencialStatus:'paga'});
 assert.match(p,/Visita técnica paga · R\$ 25,00/);
 assert.match(p,/data-qf-visita-status="paga"/);
 const pendente=visita.selo({visitaPresencialStatus:'pendente'});
 assert.match(pendente,/Pix pendente/);
 assert.doesNotMatch(pendente,/Visita técnica paga/);
 assert.equal(visita.selo({visita_presencial:'sim'}),'');
 assert.equal(visita.selo({visitaPresencialStatus:undefined}),'');
 assert.match(visita.clienteHtml({id:'123',visitaPresencialStatus:'pendente'}),/data-qf-visita-pagar/);
 assert.doesNotMatch(visita.clienteHtml({id:'123',visitaPresencialStatus:'paga'}),/data-qf-visita-pagar/);
});
test('selo está presente na listagem, detalhes e desbloqueios do profissional',()=>{
 const marks=(index.match(/global\.QFVisita\.selo\(req\)/g)||[]).length;
 assert.ok(marks>=5,'faltam cartões ou detalhe da visita');
 assert.match(index,/global\.QFVisita\.clienteHtml\(req\)/);
 assert.match(index,/qf-visita\.js\?v=/);
 assert.match(form,/qf_visita_info_chamados/);
 assert.match(form,/r\.visitaPresencialStatus=row\.visita_status/);
});
test('Pix da visita é exatamente R$25 e só vira pago com Efí E2E; repasse nunca é automático',()=>{
 assert.match(db,/valor_centavos integer not null default 2500 check\(valor_centavos=2500\)/);
 assert.match(db,/status<>'aprovado' or/i);
 assert.match(db,/end_to_end_id is not null/);
 assert.match(db,/visita_nao_escolhida/);
 assert.match(db,/a\.respostas->>'visita_presencial'='sim'/);
 assert.match(db,/public\.qf_admin_visita_marcar_repasse/);
 assert.match(db,/profissional_nao_vinculado_ao_pedido/);
 assert.match(db,/repassado_por=auth\.uid\(\)/);
 assert.doesNotMatch(db,/pix\.send|transferir.*automatic/i);
 assert.match(checkout,/\["prioridade","recarga","anuncio","visita"\]/);
 assert.match(checkout,/tipo==="visita" \? "qf_visita_pagamentos"/);
 assert.match(checkout,/tipo==="visita" && \(Number\(pay.valor_centavos\)!==2500/);
 assert.match(checkout,/tipo!=="visita"\) update.status="aprovado"/);
});
test('financeiro registra só transferência manual que já ocorreu',()=>{
 assert.match(admin,/qf_admin_visitas_pagamentos/);
 assert.match(admin,/qf_admin_visita_marcar_repasse/);
 assert.match(admin,/Eu já transferi os R\$ 25,00 manualmente/);
 assert.match(admin,/Não há transferência automática/);
 assert.match(admin,/profissionais/);
});
