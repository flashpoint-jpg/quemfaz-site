// V11.45: painel admin com barra de cima, menu lateral e páginas em cartões e tabelas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

[...admin.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => new vm.Script(m[1], { filename: 'admin-' + i + '.js' }));

// Menu na ordem combinada; cada rota do menu existe.
const menu = ['Início', 'Pedidos', 'Desbloqueios', 'Profissionais', 'Por cidade', 'Clientes', 'Receita', 'Verificações', 'Comunicados', 'Bônus', 'Planos dos profissionais', 'Planos e anúncios', 'Suporte', 'Recrutamento', 'Configurações'];
const bloco = admin.slice(admin.indexOf('const ADMIN_MENU = ['), admin.indexOf('];', admin.indexOf('const ADMIN_MENU = [')));
const labels = [...bloco.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
assert.deepEqual(labels, menu);
assert.ok(bloco.indexOf('{ divider: true }') < bloco.indexOf("label: 'Configurações'") && bloco.indexOf('{ divider: true }') > bloco.indexOf("label: 'Recrutamento'"));
[...bloco.matchAll(/route: '([^']+)'/g)].forEach((m) => assert.ok(admin.includes("{ pattern: '" + m[1] + "', role: 'admin'"), 'rota ' + m[1]));

// Tudo o que ficava em "Mais" continua alcançável pelo menu ou por Configurações/Comunicados/Pedidos.
['/admin/clientes', '/admin/categorias', '/admin/cidades', '/admin/comissao', '/admin/anuncios', '/admin/pagamentos', '/admin/cancelamentos', '/admin/suporte', '/admin/avisar-acesso', '/admin/sem-push', '/admin/versao']
  .forEach((r) => assert.ok(bloco.includes("'" + r + "'"), 'no menu: ' + r));
assert.ok(admin.includes('data-action="restaurar-demo"') && admin.includes("if (pattern === '/admin/configuracoes') bindMais(content);"));

// Início: os quatro números, tabela com filtros e "Baixar tudo"; a receita continua sendo a entrada de hoje.
['Receita de hoje', 'Pedidos de hoje', 'Desbloqueios de hoje', 'Precisa de você', "sel('adm-f-servico', 'Serviço'", "sel('adm-f-situacao', 'Situação'", 'data-adm-baixar="pedidos"']
  .forEach((t) => assert.ok(admin.includes(t), t));
assert.ok(admin.includes("n('Receita de hoje', PU.formatCurrency(en.hoje)"));
assert.ok(admin.includes("['Pedido', 'Cidade', 'Recebido', 'Quem desbloqueou', 'Situação', 'Valor']"));

// Módulos que antes só carregavam no Início também carregam nas páginas novas.
assert.equal((admin.match(/if \(pattern !== '\/admin\/dashboard' && pattern !== '\/admin\/servicos'\) return;/g) || []).length, 2);
assert.ok(admin.includes("if (pattern === '/admin/dashboard' || pattern === '/admin/comunicados') refresh();"));

// Moldura só para admin: cliente e profissional seguem com a barra de baixo.
assert.ok(admin.includes("if (session.role === 'admin') { renderAdminApp(found, user); return; }"));
assert.ok(admin.includes("function semMolduraAdmin(shell) { shell.className = ''; document.body.classList.remove('qf-adm-body'); }"));

// Cores do QuemFaz (marinho na barra, laranja no item ativo) e menu de celular.
assert.ok(admin.includes('.qf-adm-top{position:sticky;top:0;z-index:60;height:56px;display:flex;align-items:center;gap:10px;padding:0 16px 0 20px;background:var(--navy-900)'));
assert.ok(admin.includes('.qf-adm-nav__item.is-active{background:var(--orange-600);color:#fff}'));
assert.ok(admin.includes('.qf-adm--menu .qf-adm-side{visibility:visible'));

// Situação colorida e CSV.
{
  const i = admin.indexOf('  function admCsv(linhas) {');
  const j = admin.indexOf('  function admBaixarPedidos() {');
  const sc = { String };
  vm.runInNewContext(admin.slice(i, j) + '\nthis.f = admCsv;', sc);
  assert.equal(sc.f([['Pedido', 'Valor'], ['Pintura; sala', '4,90']]), '﻿Pedido;Valor\r\n"Pintura; sala";4,90');
}
console.log('PASS painel com menu lateral: menu, rotas, início, módulos e cores');

// V11.48: bônus de cadastro com chave no painel; o app só promete bônus quando ele está ligado.
{
  const site = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(admin.includes("rpc('qf_admin_salvar_bonus_cadastro', { p_ativo: ativo, p_valor_centavos: cents })"));
  assert.ok(admin.includes("if (pattern === '/admin/bonus') admBonusCadastroCarregar(content);"));
  assert.ok(site.includes("client.rpc('qf_bonus_cadastro_info')"));
  assert.ok(!/R\$ ?25/.test(site), 'o site não pode prometer R$ 25 fixo');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '2026-10-10-bonus-cadastro-chave.sql'), 'utf8');
  assert.ok(sql.includes(`'{"ativo": false, "valor_centavos": 2500}'`) && sql.includes('if not v_ativo or v_valor <= 0 then') && sql.includes('if not private.qf_is_admin() then'));
}

// V11.49: plano Premium e etapa 5 do cadastro (escolha do plano).
{
  const site = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  // V11.55: os números do Premium vêm de QFPlanos (painel); 19990 / 60 é só o ponto de partida.
  assert.ok(site.includes("premium: { nome: 'Premium', preco: 19990, chamados: 60, dias: 30 }") && site.includes("qfCadPlano('premium', 'MAIS COMPLETO'"));
  assert.ok(site.includes('Etapa 5 de 5') && !site.includes('Etapa 4 de 4') && site.includes('name="planoEscolhido"'));
  assert.ok(site.includes("goStep(Math.min(5, stepAtual + 1));") && site.includes("if (stepAtual < 5) { avancar(); return; }"));
  // V11.50: plano pago vai para o pagamento antes da conta; só o boleto ainda abre na Carteira depois do cadastro.
  assert.ok(site.includes("sessionStorage.setItem('qf_plano_pos_cadastro', planoId)") && site.includes("openRechargeSheet(user, pl.valor, metodoEscolhido, pl.id)"));
  assert.ok(site.includes("if (!out.pagamento_id && !out.incluido_no_plano)") && site.includes('Anúncio incluído no seu Premium'));
  assert.ok(site.includes("client.rpc('qf_profissionais_premium'") && site.includes('qf-selo-premium'));
  assert.ok(admin.includes("p.plano === 'premium' ? 'Premium'"));
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', '2026-10-10-plano-premium.sql'), 'utf8');
  assert.ok(sql.includes("values ('premium', 'Premium', 19990, 60, 30, true)") && sql.includes("'incluido_no_plano', true"));
}
