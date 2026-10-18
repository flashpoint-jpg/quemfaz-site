const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../qf-valor-definido.js');

test('parseBRL entende formatos brasileiros e rejeita lixo', () => {
  assert.equal(V.parseBRL('1.500,00'), 150000);
  assert.equal(V.parseBRL('R$ 1.500'), 150000);
  assert.equal(V.parseBRL('1500'), 150000);
  assert.equal(V.parseBRL('90,5'), 9050);
  assert.equal(V.parseBRL('1500.50'), 150050);
  assert.equal(V.parseBRL(''), null);
  assert.equal(V.parseBRL('abc'), null);
  assert.equal(V.parseBRL(null), null);
});

test('formatBRL', () => {
  assert.equal(V.formatBRL(150000), 'R$ 1.500,00');
  assert.equal(V.formatBRL(9005), 'R$ 90,05');
  assert.equal(V.formatBRL(0), 'R$ 0,00');
});

test('validarValor: obrigatório, mínimo e máximo', () => {
  assert.equal(V.validarValor(null).motivo, 'obrigatorio');
  assert.equal(V.validarValor(0).motivo, 'obrigatorio');
  assert.equal(V.validarValor(1999).motivo, 'minimo');
  assert.equal(V.validarValor(50000001).motivo, 'maximo');
  assert.equal(V.validarValor(2000).ok, true);
  assert.equal(V.validarValor(50000000).ok, true);
});

test('calcularTaxa: 6% do exemplo, arredondamento e teto', () => {
  assert.equal(V.calcularTaxa(150000, 600), 9000);
  assert.equal(V.calcularTaxa(2050, 600), 123); // 123,0
  assert.equal(V.calcularTaxa(2091, 600), 125); // 125,46 -> 125
  assert.equal(V.calcularTaxa(2092, 600), 126); // 125,52 -> 126
  assert.equal(V.calcularTaxa(2508, 600), 150); // 150,48 -> 150
  assert.equal(V.calcularTaxa(1000000, 600, 20000), 20000);
  assert.equal(V.calcularTaxa(0, 600), 0);
});

test('montarCamposPedido: tradicional não envia nenhum campo de valor', () => {
  const r = V.montarCamposPedido({ modalidade: 'contatos', valorTexto: '999' });
  assert.deepEqual(r, { ok: true, campos: { modalidade: 'contatos' } });
});

test('montarCamposPedido: valor definido exige valor, material, confirmação e descrição', () => {
  const base = { modalidade: 'valor_definido', valorTexto: '1.500,00', materialIncluso: true, confirmou: true, descricao: 'Trocar o chuveiro elétrico' };
  const ok = V.montarCamposPedido(base, null, new Date('2026-10-18T10:00:00Z'));
  assert.equal(ok.ok, true);
  assert.equal(ok.campos.valor_oferecido_centavos, 150000);
  assert.equal(ok.campos.max_orcamentos, 1);
  assert.equal(ok.campos.valor_confirmado_em, '2026-10-18T10:00:00.000Z');
  assert.equal(V.montarCamposPedido({ ...base, valorTexto: '' }).campo, 'valor');
  assert.equal(V.montarCamposPedido({ ...base, valorTexto: '5' }).campo, 'valor');
  assert.equal(V.montarCamposPedido({ ...base, materialIncluso: undefined }).campo, 'material');
  assert.equal(V.montarCamposPedido({ ...base, confirmou: false }).campo, 'confirmacao');
  assert.equal(V.montarCamposPedido({ ...base, descricao: 'curto' }).campo, 'descricao');
  assert.equal(V.montarCamposPedido({ ...base, materialIncluso: false }).campos.material_incluso, false);
});

test('textos: nunca usa "Serviço Garantido" nem "Serviço Fechado"', () => {
  const todo = [V.ROTULO, V.etiquetaHtml(), V.seletorModalidadeHtml(), V.cancelamentoHtml(),
    V.resumoValorHtml({ modalidade: 'valor_definido', valor: 150000, materialIncluso: true, taxa: 9000 })].join(' ');
  assert.ok(!/Servi[çc]o Garantido|Servi[çc]o Fechado/i.test(todo));
  assert.ok(todo.includes('Valor confirmado pelo cliente'));
  assert.ok(todo.includes('Receber até 4 contatos'));
  assert.ok(todo.includes('Já tenho um valor para pagar'));
});

test('resumoValorHtml mostra a taxa exata e só existe para valor definido', () => {
  const h = V.resumoValorHtml({ modalidade: 'valor_definido', valor: 150000, materialIncluso: false, taxa: 9000 });
  assert.ok(h.includes('R$ 1.500,00') && h.includes('R$ 90,00') && h.includes('por conta do cliente'));
  assert.equal(V.resumoValorHtml(null), '');
  assert.equal(V.resumoValorHtml({ modalidade: 'contatos' }), '');
});

test('HTML escapa conteúdo do usuário', () => {
  assert.ok(V.baixaHtml('https://x/?"><script>', '2026-10-25').indexOf('<script>') === -1);
  assert.equal(V.esc('<b>"a"</b>'), '&lt;b&gt;&quot;a&quot;&lt;/b&gt;');
});

test('mensagemDesbloqueio informa o valor exato que falta', () => {
  assert.match(V.mensagemDesbloqueio({ reason: 'saldo_insuficiente', taxa: 9000, saldo: 4000, falta: 5000 }), /R\$ 50,00.*R\$ 90,00/);
  assert.match(V.mensagemDesbloqueio({ reason: 'reservado' }), /Outro profissional/);
  assert.match(V.mensagemDesbloqueio({ reason: 'taxa_mudou' }), /taxa mudou/);
});

test('cancelamento oferece os 5 motivos do contrato com o banco', () => {
  assert.deepEqual(V.MOTIVOS_CANCELAMENTO.map(m => m.id), ['imprevisto', 'financeiro', 'nao_precisa_mais', 'nao_combinou', 'outro']);
  assert.deepEqual(V.RESPOSTAS_CONCLUSAO.map(m => m.id), ['concluido', 'com_problema', 'nao_realizado']);
});

test('link seguro: token só no fragmento (#), nunca na query', () => {
  const tok = 'a'.repeat(64);
  const link = V.linkConfirmacao('https://quemfazservico.com.br/', tok);
  assert.equal(link, 'https://quemfazservico.com.br/confirmar-servico.html#t=' + tok);
  assert.equal(V.tokenDoHash('#t=' + tok), tok);
  assert.equal(V.tokenDoHash('#t=curto'), null);
  assert.equal(V.tokenDoHash(''), null);
});

test('com a chave desligada nada é enriquecido nem chamado', async () => {
  let chamou = false;
  global.QFCloud = { client: { rpc() { chamou = true; return Promise.resolve({ data: [] }); } } };
  const reqs = [{ id: '1' }];
  await V.enriquecer(reqs);
  assert.equal(chamou, false);
  assert.equal(V.ativo(), false);
  assert.equal(reqs[0].modalidade, undefined);
});

test('com a chave ligada enriquece só o que o banco devolve', async () => {
  global.QFCloud = { client: { rpc(n) {
    if (n === 'qf_pedidos_valor_config') return Promise.resolve({ data: { ativo: true, percentual_bps: 600, valor_min_centavos: 2000, valor_max_centavos: 50000000 } });
    return Promise.resolve({ data: [{ chamado_id: 'b', modalidade: 'valor_definido', valor_oferecido_centavos: 150000, material_incluso: true, taxa_centavos: 9000, vagas: 1 }] });
  } } };
  await V.carregarConfig(true);
  assert.equal(V.ativo(), true);
  const reqs = [{ id: 'a' }, { id: 'b' }];
  await V.enriquecer(reqs);
  assert.equal(reqs[0].valorDefinido, undefined);
  assert.equal(reqs[1].valorDefinido.taxa, 9000);
  assert.equal(reqs[1].valorDefinido.vagas, 1);
});

test('falha na configuração mantém tudo desligado', async () => {
  global.QFCloud = { client: { rpc() { return Promise.reject(new Error('x')); } } };
  await V.carregarConfig(true);
  assert.equal(V.ativo(), false);
});

test('confirmação 24h: html lista pedidos com as duas respostas', () => {
  const h = V.confirmacoesHtml([{ chamado_id: 'abc', categoria: 'cat_eletricista', cidade: 'Muzambinho', valor_oferecido_centavos: 15000 }]);
  assert.match(h, /O cliente respondeu\?/);
  assert.match(h, /data-r="cliente_respondeu"/);
  assert.match(h, /data-r="cliente_nao_respondeu"/);
  assert.match(h, /R\$\s*150,00/);
  assert.equal(V.confirmacoesHtml([]), '');
});

test('confirmação 24h: mensagem de bloqueio e escape de html', () => {
  assert.match(V.mensagemDesbloqueio({ reason: 'confirmacao_pendente' }), /24 h/);
  assert.doesNotMatch(V.confirmacoesHtml([{ chamado_id: '"><script>', categoria: 'x' }]), /<script>/);
});

test('confirmação 24h: RPCs corretas', async () => {
  const calls = [];
  global.QFCloud = { client: { rpc(n, a) { calls.push([n, a]); return Promise.resolve({ data: n === 'qf_contatos_pendentes' ? [{ chamado_id: 'z' }] : { ok: true }, error: null }); } } };
  assert.equal((await V.contatosPendentes()).length, 1);
  await V.confirmarContato('z', 'cliente_nao_respondeu');
  assert.deepEqual(calls[1], ['qf_confirmar_contato', { p_chamado_id: 'z', p_resposta: 'cliente_nao_respondeu' }]);
});
