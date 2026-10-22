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
