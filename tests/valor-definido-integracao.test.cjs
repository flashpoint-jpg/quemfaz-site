const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const A = require('../qf-admin-valor.js');
const V = require('../qf-valor-definido.js');
const root = path.join(__dirname, '..');
const load = f => fs.readFileSync(path.join(root, f), 'utf8');

test('admin: converte percentual e teto sem erro de arredondamento', () => {
  assert.equal(A.pctParaBps('6'), 600);
  assert.equal(A.pctParaBps('6,5'), 650);
  assert.equal(A.pctParaBps(''), null);
  assert.equal(A.pctParaBps('abc'), null);
  assert.equal(A.reaisParaCentavos('200'), 20000);
  assert.equal(A.reaisParaCentavos('1.250,50'), 125050);
  assert.equal(A.reaisParaCentavos(''), null);
  assert.equal(A.reaisParaCentavos('x'), undefined);
});

test('admin: lista mostra valor, taxa, profissional, pagamento, baixa, cancelamento e contestação', () => {
  const h = A.pedidoHtml({
    id: '11111111-2222-3333-4444-555555555555', categoria: 'cat_eletricista', cidade: 'Santo André', uf: 'SP', status: 'em_negociacao',
    modalidade: 'valor_definido', valor_oferecido_centavos: 150000, material_incluso: true, criado_em: '2026-10-18T10:00:00Z',
    desbloqueios: [{ profissional: 'João', taxa_centavos: 9000, pagamento_confirmado: true, ativo: true, criado_em: '2026-10-18T11:00:00Z' }],
    conclusao: { id: 'c1', status: 'pendente', criado_em: '2026-10-18T12:00:00Z' },
    cancelamento: { motivo: 'financeiro', detalhe: null, houve_desbloqueio: true, criado_em: '2026-10-18T13:00:00Z' },
    contestacoes: [{ id: 'k1', status: 'pendente', motivo: 'contato_falso', descricao: 'número não existe', valor_estornado_centavos: null }]
  });
  for (const t of ['Valor definido', 'R$ 1.500,00', 'R$ 90,00', 'João', 'pagamento confirmado', 'Aguardando o cliente', 'Problema financeiro', 'contato_falso', 'data-qf-encerrar="c1"', 'data-qf-resolver="k1"', 'Histórico completo']) {
    assert.ok(h.includes(t), 'faltou: ' + t);
  }
});

test('admin: escapa HTML vindo do banco', () => {
  const h = A.pedidoHtml({ id: 'x"><img src=x>', categoria: '<b>', status: 's', modalidade: 'contatos', desbloqueios: [{ profissional: '<script>alert(1)</script>' }] });
  assert.ok(!h.includes('<script>') && !h.includes('<img src=x>'));
});

test('admin: pedido tradicional não mostra valor; suspeitos só listam (sem ação de bloqueio)', () => {
  const h = A.pedidoHtml({ id: 'a', categoria: 'cat_x', status: 'aberto', modalidade: 'contatos' });
  assert.ok(h.includes('Tradicional') && !h.includes('Valor do cliente'));
  const s = A.suspeitosHtml([{ cliente: 'Maria', total: 4, com_desbloqueio: 3, ultimo: '2026-10-01T00:00:00Z' }]);
  assert.ok(s.includes('revisão humana') && s.includes('Nada é bloqueado automaticamente') && !/data-qf-bloquear/.test(s));
});

test('admin: tabela de taxas permite padrão, teto por profissão e nova profissão', () => {
  const h = A.taxasHtml({ taxas: [{ categoria: 'padrao', percentual_bps: 600, teto_centavos: null }, { categoria: 'cat_eletricista', percentual_bps: 500, teto_centavos: 20000 }] });
  assert.ok(h.includes('Padrão (todas as profissões)') && h.includes('value="5"') && h.includes('value="200"') && h.includes('data-qf-taxa-nova'));
});

test('index.html: tudo atrás da chave e nada muda para pedidos tradicionais', () => {
  const html = load('index.html');
  assert.match(html, /qf-valor-definido\.js\?v=1/);
  // formulário só ganha o seletor quando a chave está ligada
  assert.match(html, /if \(!global\.QFValor\.ativo\(\) \|\| !form\.isConnected/);
  // validação do pedido B só roda com a chave ligada e modalidade escolhida
  assert.match(html, /global\.QFValor\.ativo\(\) && String\(fd\.get\('modalidade'\)/);
  // pedido tradicional continua mandando a quantidade escolhida pelo cliente
  assert.match(html, /maxOrcamentos: valorExtra \? 1 : \(Number\(fd\.get\('maxOrcamentos'\)\) \|\| 3\)/);
  // desbloqueio de valor definido usa a função própria, com a taxa confirmada
  assert.match(html, /global\.QFValor\.desbloquear\(params\.id, vd\.taxa\)/);
  // o desbloqueio tradicional continua chamando a função antiga
  assert.match(html, /client\.rpc\('qf_desbloquear_chamado'/);
  // exclusivo não existe para pedido com valor
  assert.match(html, /req\.valorDefinido \|\| req\.modalidade === 'valor_definido'\) return false/);
  // cancelamento: com a chave ligada usa o modal com motivos; senão, o diálogo anterior
  assert.match(html, /act === 'cancelar-pedido' && global\.QFValor && global\.QFValor\.ativo\(\)/);
});

test('versões do app e do service worker continuam iguais', () => {
  const app = /const APP_VERSION = '([^']+)'/.exec(load('index.html'))[1];
  const sw = /const SW_VERSION = '([^']+)'/.exec(load('sw.js'))[1];
  assert.equal(app, sw);
});

test('nenhum texto novo promete "Serviço Garantido" ou "Serviço Fechado"', () => {
  for (const f of ['qf-valor-definido.js', 'qf-admin-valor.js', 'qf-carteirinha-extras.js', 'confirmar-servico.html']) {
    assert.doesNotMatch(load(f), /Servi[çc]o (Garantido|Fechado)/i, f);
  }
});

test('confirmar-servico.html: exige conta, token só no # e some da barra de endereço', () => {
  const h = load('confirmar-servico.html');
  assert.match(h, /qf_cliente_conclusoes_pendentes/);
  assert.match(h, /qf_conclusao_responder/);
  assert.match(h, /getSession\(\)/);
  assert.match(h, /history\.replaceState/);
  assert.match(h, /name="referrer" content="no-referrer"/);
  assert.match(h, /data-r="concluido"/);
  assert.match(h, /data-r="com_problema"/);
  assert.match(h, /data-r="nao_realizado"/);
  assert.match(h, /Dê uma nota de 1 a 5 estrelas/);
  assert.doesNotMatch(h, /location\.search/); // token nunca na query string
});

test('contestação e cancelamento enviam exatamente os motivos aceitos pelo banco', () => {
  const sql = load('supabase/2026-10-18-pedidos-valor-definido-qr.sql');
  for (const m of V.MOTIVOS_CONTESTACAO.map(x => x.id)) assert.ok(sql.includes("'" + m + "'"), m);
  for (const m of V.MOTIVOS_CANCELAMENTO.map(x => x.id)) assert.ok(sql.includes("'" + m + "'"), m);
});

test('a migração nasce desligada e não mexe nos preços tradicionais', () => {
  const sql = load('supabase/2026-10-18-pedidos-valor-definido-qr.sql');
  assert.match(sql, /'ativo', false/);
  assert.doesNotMatch(sql, /update\s+public\.qf_precos_desbloqueio|delete\s+from\s+public\.qf_(chamados|carteiras|movimentacoes|avaliacoes|desbloqueios)/i);
});
