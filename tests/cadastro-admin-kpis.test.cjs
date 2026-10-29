const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const front=fs.readFileSync('qf-admin-cadastro-pago.js','utf8');
const admin=fs.readFileSync('admin.html','utf8');
const migration=fs.readFileSync('supabase/2026-10-28-cadastro-pagante-kpis.sql','utf8');
const listSql=fs.readFileSync('supabase/migrations/20261028191000_admin_pre_cadastros.sql','utf8');

test('Painel administrativo carrega com sintaxe válida e conexão realmente existente',()=>{
 new vm.Script(front,{filename:'qf-admin-cadastro-pago.js'});
 assert.match(admin,/qf-admin-cadastro-pago\.js\?v=20261028-saldo-movimentacoes/);
 assert.match(front,/global\.QFAdminCloud/,'usa cliente real do administrativo');
 assert.doesNotMatch(front,/global\.QFCloud\b/,'não usar o nome errado que escondia cadastros');
 assert.match(admin,/global\.QFAdminCloud\s*=/);
 assert.match(front,/\.rpc\('qf_admin_cadastro_pagamentos'\)/);
 assert.match(front,/\.rpc\('qf_admin_pre_cadastros'/);
});

test('Administrativo permite localizar nome, contato, plano e estágio de pagamento sem confundir com cadastro ativo',()=>{
 for(const s of ['Pré-cadastros dos profissionais','Aguardando pagamento','Avulso','Quem Faz Livre',
 'data-qf-pre-form','state.busca','state.situacao','data-qf-pre-next','data-qf-pre-refresh',
 'Sem perfil ativo e sem saldo liberado','QFAdminCloud','qfPreNav'])
 assert.ok(front.includes(s),'falta elemento '+s);
 assert.match(front,/Não confirmado pela Efí/);
 assert.match(front,/r\.perfil_ativo===true/);
});

test('Consulta SQL protege dados pessoais e não entrega segredos ou checkout',()=>{
 assert.match(listSql,/auth\.uid\(\)\s+IS\s+NULL\s+OR\s+NOT\s+private\.qf_is_admin\(\)/i);
 assert.match(listSql,/REVOKE ALL ON FUNCTION public\.qf_admin_pre_cadastros/);
 assert.match(listSql,/GRANT EXECUTE ON FUNCTION public\.qf_admin_pre_cadastros.*TO authenticated/);
 assert.doesNotMatch(listSql,/p\.segredo\b/);
 assert.doesNotMatch(listSql,/p\.checkout_url\b/);
 for(const field of ['p.nome','p.email','p.telefone','p.plano','p.valor_centavos','p.metodo',
 'p.status','p.provedor_id','p.profissional_id','p.aprovado_em','p.resgatado_em'])
 assert.ok(listSql.includes(field),field);
 assert.match(listSql,/p\.plano IN \('avulso','livre'\)/);
 assert.match(listSql,/v_limite integer := least\(/);
});

test('Indicadores de caixa existentes seguem protegidos e não confundem saldo com faturamento',()=>{
 assert.match(migration,/not private\.qf_is_admin\(\)/i);
 for(const k of ['pre_cadastros_pendentes','pre_cadastros_abandonados','pagos_ainda_nao_resgatados',
 'profissionais_ativos','avulsos_iniciais_pagos','livres_iniciais_pagos','livres_vigentes','livres_vencidos',
 'recebido_avulso_inicial_centavos','recebido_livre_inicial_centavos','saldo_carteiras_total_centavos'])
 assert.ok(migration.includes("'"+k+"'"),k);
 assert.ok(!migration.includes("'receita_efetiva'"));
});

test('Saldo das carteiras é exclusivo de Movimentações e ausente da ficha de cadastro',()=>{
 const pre=front.slice(front.indexOf('  function render(panel,s,d){'),front.indexOf('  async function load(panel){'));
 const route=front.slice(front.indexOf('  function host(){'),front.indexOf('  function insertMenu(){'));
 assert.ok(pre.length>1000 && route.length>80,'funções principais encontradas');
 assert.doesNotMatch(pre,/saldo_carteiras_total_centavos|qf-pre-finance|Conciliação e valores|Carteiras \(inclui outros créditos\)/);
 assert.ok(route.includes(String.raw`if(!/^#\/admin\/planos`),'cadastros somente em Planos');
 for(const other of ['dashboard','profissionais','financeiro','clientes'])assert.ok(!route.includes(other),'cadastro indevidamente em '+other);
 assert.match(front,/function movementHost\(\)/);
 assert.ok(front.includes(String.raw`/^#\/admin\/movimentacoes`),'saldo somente em Movimentações');
 assert.match(front,/function renderWallet\(panel, data\)/);
 assert.match(front,/data\.saldo_carteiras_total_centavos/);
 assert.match(front,/Créditos nas carteiras dos profissionais/);
 assert.match(front,/Não é o faturamento do Quem Faz/);
 assert.ok(admin.includes("pattern: '/admin/movimentacoes'"));
 assert.ok(admin.includes("label: 'Movimentações'"));
 const fin=fs.readFileSync('qf-admin-financeiro.js','utf8');
 assert.ok(fin.includes("'/admin/financeiro','/admin/movimentacoes',"),"Movimentações visível no menu principal");
 assert.ok(admin.includes("qf-admin-financeiro.js?v=pix-manual-20261029"),"Cache do menu renovado");
});
