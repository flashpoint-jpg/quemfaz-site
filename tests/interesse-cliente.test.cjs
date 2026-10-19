const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../qf-valor-definido.js');
const load = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('pergunta do cliente: texto pedido, duas opções, nenhuma marcada, obrigatória', () => {
  const h = V.campoInteresseHtml();
  assert.match(h, /Você pretende contratar um profissional\?/);
  assert.match(h, /Sim, quero receber propostas para contratar\./);
  assert.match(h, /Estou apenas pesquisando preços\./);
  assert.equal((h.match(/type="radio"/g) || []).length, 2);
  assert.match(h, /name="interesseContratar" value="contratar"/);
  assert.match(h, /name="interesseContratar" value="pesquisando"/);
  assert.doesNotMatch(h, /\schecked|selected/i, 'nunca marca interesse automaticamente');
  assert.equal((h.match(/required/g) || []).length, 2);
});

test('validação: só contratar/pesquisando valem; vazio bloqueia a publicação', () => {
  assert.deepEqual(V.validarInteresse('contratar'), { ok: true, valor: 'contratar' });
  assert.deepEqual(V.validarInteresse('pesquisando'), { ok: true, valor: 'pesquisando' });
  for (const ruim of [null, undefined, '', ' ', 'sim', 'CONTRATAR', 'true', 1]) {
    const r = V.validarInteresse(ruim);
    assert.equal(r.ok, false, 'deve recusar ' + String(ruim));
    assert.equal(r.valor, null);
    assert.match(r.mensagem, /Escolha uma opção/);
  }
});

test('selo: só com "contratar" E data/hora registrada; nunca para "pesquisando" nem pedido antigo', () => {
  const h = V.seloInteresseHtml({ interesseCliente: 'contratar', interesseConfirmadoEm: '2026-10-19T16:00:00Z' });
  assert.match(h, /Interesse confirmado pelo cliente/);
  assert.match(h, /qf-interesse-selo/);
  assert.match(h, /Não é garantia de contratação/);
  assert.equal(V.seloInteresseHtml({ interesseCliente: 'pesquisando', interesseConfirmadoEm: '2026-10-19T16:00:00Z' }), '');
  assert.equal(V.seloInteresseHtml({ interesseCliente: 'contratar', interesseConfirmadoEm: null }), '', 'sem data registrada: sem selo');
  assert.equal(V.seloInteresseHtml({ interesseCliente: null, interesseConfirmadoEm: null }), '');
  assert.equal(V.seloInteresseHtml({}), '', 'pedido antigo');
  assert.equal(V.seloInteresseHtml(null), '');
  assert.equal(V.seloInteresseHtml(undefined), '');
});

test('enriquecerInteresse: anexa só o que o banco devolve, não mexe em pedido antigo e falha em silêncio', async () => {
  const calls = [];
  global.QFCloud = { client: { rpc(n, a) { calls.push([n, a]); return Promise.resolve({ data: [{ chamado_id: 'a', interesse_confirmado_em: '2026-10-19T16:00:00Z' }], error: null }); } } };
  const reqs = [{ id: 'a' }, { id: 'b' }, { id: 'c', interesseCliente: 'contratar', interesseConfirmadoEm: '2026-10-01T10:00:00Z' }];
  await V.enriquecerInteresse(reqs);
  assert.equal(reqs[0].interesseCliente, 'contratar');
  assert.equal(reqs[0].interesseConfirmadoEm, '2026-10-19T16:00:00Z');
  assert.equal(reqs[1].interesseCliente, undefined, 'pedido que o banco não devolveu fica sem selo');
  assert.equal(reqs[2].interesseConfirmadoEm, '2026-10-01T10:00:00Z');
  assert.deepEqual(calls[0], ['qf_interesse_info_chamados', { p_ids: ['a', 'b'] }]);
  // linha sem data não vira selo
  global.QFCloud = { client: { rpc() { return Promise.resolve({ data: [{ chamado_id: 'z', interesse_confirmado_em: null }], error: null }); } } };
  const r1 = [{ id: 'z' }];
  await V.enriquecerInteresse(r1);
  assert.equal(r1[0].interesseCliente, undefined);
  // erro do banco / rede: segue sem selo, sem estourar
  global.QFCloud = { client: { rpc() { return Promise.reject(new Error('x')); } } };
  const r2 = [{ id: 'y' }];
  assert.equal((await V.enriquecerInteresse(r2))[0].id, 'y');
  assert.equal(r2[0].interesseCliente, undefined);
  global.QFCloud = { client: { rpc() { return Promise.resolve({ data: null, error: { message: 'x' } }); } } };
  const r3 = [{ id: 'w' }];
  await V.enriquecerInteresse(r3);
  assert.equal(r3[0].interesseCliente, undefined);
  delete global.QFCloud;
});

test('index.html: pergunta na última tela antes do botão, obrigatória, gravada no pedido, selo antes do desbloqueio', () => {
  const html = load('index.html');
  // pergunta fica depois do contato e antes do botão de enviar do pedido principal
  const iCampo = html.indexOf("global.QFValor.campoInteresseHtml() : '') +\n          '<button class=\"btn btn--outline\" type=\"button\" data-qf-sub-ir=\"b\">Voltar");
  const iContato = html.indexOf('class="qf-request-contact"');
  const iEnviar = html.indexOf('class="btn btn--primary qf-request-submit"');
  assert.ok(iContato > 0 && iCampo > iContato && iEnviar > iCampo, 'campo entre o contato e o botão de enviar');
  // obrigatória antes de publicar (pedido principal e tela antiga de pedido)
  assert.equal((html.match(/global\.QFValor\.validarInteresse\(fd\.get\('interesseContratar'\)\)/g) || []).length, 2);
  assert.match(html, /interesseCliente: interesseCliente/);
  assert.match(html, /prioridadeMetodo: prioridadeMetodo, interesseCliente: interesseCliente/);
  // gravação: só o valor escolhido; a data/hora é do banco
  assert.match(html, /if \(comInteresse\) row\.interesse_cliente = data\.interesseCliente;/);
  assert.doesNotMatch(html, /interesse_confirmado_em\s*[:=]\s*(?!row\.)/, 'o aparelho nunca grava a data de confirmação');
  assert.doesNotMatch(html, /interesse_cliente\s*=\s*['"]contratar['"]|interesseCliente\s*=\s*['"]contratar['"]/, 'nunca marca "contratar" por conta própria');
  // pedido que o banco recusa o campo continua sendo publicado, sem selo
  assert.match(html, /delete row\.interesse_cliente;/);
  // leitura
  assert.match(html, /interesseCliente: \(row\.interesse_cliente === 'contratar' \|\| row\.interesse_cliente === 'pesquisando'\)/);
  assert.match(html, /global\.QFValor\.enriquecerInteresse\(reqs\)/);
  // selo nos dois lugares em que o profissional vê o pedido antes de pagar, sempre antes do orçamento aproximado
  const selos = html.match(/seloInteresseHtml\(req\) : ''\) \+\n\s*\(global\.QFValor \? global\.QFValor\.orcamentoHtml/g) || [];
  assert.equal(selos.length, 2);
  // limite de 4 profissionais e nada de cobrança tocado
  assert.match(html, /\[1, 2, 3, 4\]\.map\(function \(n\)/);
  assert.match(html, /Math\.max\(1, Math\.min\(4, Math\.round\(Number\(req\.maxOrcamentos/);
  assert.match(html, /qf-valor-definido\.js\?v=5/);
});

test('selo é verde e discreto; pergunta tem estilo próprio', () => {
  const html = load('index.html');
  assert.match(html, /\.qf-interesse-selo \{[^}]*background:#e9f7ef;color:#0b5c36/);
  assert.match(html, /\.qf-interesse__opt \{[^}]*min-height:48px/);
});

test('versão do app e do service worker foram atualizadas juntas', () => {
  const html = load('index.html'), sw = load('sw.js');
  const app = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  const swv = /const SW_VERSION = '([^']+)'/.exec(sw)[1];
  assert.equal(app, swv);
  assert.equal(app, '12.0.3');
});

test('migração: aditiva, sem tocar pedidos antigos, preços, saldos, recargas nem desbloqueios', () => {
  const sql = load('supabase/2026-10-19-interesse-do-cliente.sql');
  assert.match(sql, /add column if not exists interesse_cliente text;/);
  assert.match(sql, /add column if not exists interesse_confirmado_em timestamptz;/);
  assert.doesNotMatch(sql, /interesse_cliente text[^;]*(default|not null)/i, 'sem valor padrão: nada é marcado sozinho');
  assert.match(sql, /interesse_cliente in \('contratar', 'pesquisando'\)/);
  assert.match(sql, /new\.interesse_confirmado_em := now\(\);/, 'data/hora do servidor');
  assert.match(sql, /raise exception 'interesse_imutavel'/);
  assert.match(sql, /c\.interesse_cliente = 'contratar'/, 'leitura só devolve quem quer contratar');
  assert.match(sql, /revoke all on function public\.qf_interesse_info_chamados\(uuid\[\]\) from public, anon;/);
  assert.doesNotMatch(sql, /\bupdate\s+public\.|delete\s+from|truncate|\bdrop\s+table|qf_carteiras|qf_recargas|qf_movimentacoes|qf_precos|qf_desbloqueios\s+set|qf_config/i);
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*interesse/i, 'escolha não pode ser alterada pelo cliente depois');
});
