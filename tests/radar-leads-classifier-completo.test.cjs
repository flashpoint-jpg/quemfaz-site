const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classifyLead, inviteMessage, redact } = require('../scripts/radar-leads-classifier.cjs');

// Todos os textos abaixo são FICTÍCIOS (fixtures de teste), não capturas reais.
const classify = text => classifyLead({ authorizedSource: true, url: 'https://forum.teste.invalid/p/1', source: 'teste', text });

test('as cinco frases do briefing viram oportunidades com serviço e cidade corretos', () => {
  const cases = [
    ['Preciso de pintor em Santo André.', 'pintor', 'Santo André'],
    ['Alguém indica eletricista em São Bernardo?', 'eletricista', 'São Bernardo do Campo'],
    ['Procuro diarista em São Caetano.', 'diarista', 'São Caetano do Sul'],
    ['Preciso limpar meu sofá em Diadema.', 'limpeza de sofá', 'Diadema'],
    ['Alguém conhece um encanador em Mauá?', 'encanador', 'Mauá']
  ];
  for (const [text, service, city] of cases) {
    const r = classify(text);
    assert.equal(r.accepted, true, text);
    assert.equal(r.service, service, text);
    assert.equal(r.city, city, text);
    assert.equal(r.intent, 'procura_profissional');
  }
});

test('separa quem procura de quem oferece serviço', () => {
  for (const text of [
    'Sou pintor em Santo André, ofereço meus serviços',
    'Pintor em Santo André. Orçamento sem compromisso! Chama no whats (11) 91234-5678',
    'Eletricista em Mauá, atendemos toda a região. Ligue (11) 91234-5678'
  ]) {
    const r = classify(text);
    assert.equal(r.accepted, false, text);
    assert.equal(r.intent, 'oferta_servico', text);
  }
});

test('não confunde compra de móvel com limpeza de sofá nem cidade fora do ABC', () => {
  assert.equal(classify('Preciso comprar um sofá novo em Mauá').accepted, false);
  assert.equal(classify('Preciso de pintor em Pequenópolis').reason, 'fora_da_regiao');
  assert.equal(classify('Bom dia a todos de Santo André').reason, 'servico_nao_identificado');
});

test('identifica bairro, urgência e infere a cidade pelo bairro inequívoco', () => {
  const r = classify('Preciso de pintor urgente no Rudge Ramos');
  assert.equal(r.accepted, true);
  assert.equal(r.neighborhood, 'Rudge Ramos');
  assert.equal(r.city, 'São Bernardo do Campo');
  assert.equal(r.urgency, 'urgente');
  assert.ok(r.confidence >= 0.7);
});

test('remove telefone, e-mail, CPF e @usuário do trecho guardado', () => {
  const r = classify('Preciso de pintor em Diadema, falar com @fulano_teste ou (11) 91234-5678 ou fulano@teste.invalid CPF 123.456.789-09');
  assert.equal(r.accepted, true);
  for (const dado of ['91234', '@fulano', 'fulano@', '123.456.789']) assert.equal(r.excerpt.includes(dado), false, dado);
  assert.equal(redact('ligue 11 91234 5678').includes('91234'), false);
});

test('fonte não autorizada, URL inválida ou http simples são recusadas', () => {
  assert.equal(classifyLead({ authorizedSource: false, url: 'https://x.invalid/1', text: 'Preciso de pintor em Mauá' }).reason, 'fonte_nao_autorizada');
  assert.equal(classifyLead({ authorizedSource: true, url: 'não é url', text: 'Preciso de pintor em Mauá' }).reason, 'url_invalida');
  assert.equal(classifyLead({ authorizedSource: true, url: 'http://x.invalid/1', text: 'Preciso de pintor em Mauá' }).reason, 'url_invalida');
});

test('convite usa o texto combinado e leva o link rastreável', () => {
  const link = 'https://quemfazservico.com.br/?servico=pintor&utm_source=radar&utm_medium=convite&utm_content=abc';
  const msg = inviteMessage('pintor', link);
  assert.match(msg, /^Está procurando um pintor\? Publique seu pedido gratuitamente no Quem Faz e receba até 4 contatos de profissionais da sua região\./);
  assert.ok(msg.endsWith(link));
  assert.match(inviteMessage('desconhecido', link), /Está procurando um profissional\?/);
});

test('todo slug de serviço existe no formulário atual (parâmetro ?servico=)', () => {
  const acquisition = fs.readFileSync(path.join(__dirname, '..', 'qf-client-acquisition.js'), 'utf8');
  const { SERVICES } = require('../qf-radar-classifier.js');
  for (const s of SERVICES) {
    assert.ok(new RegExp(`\\b${s.slug}\\s*:\\s*'cat_`).test(acquisition), `slug sem categoria no formulário: ${s.slug}`);
  }
});

test('aceita pedidos de outras regiões atendidas, além do Grande ABC', () => {
  const r = classify('Preciso de eletricista urgente em Campinas, alguém indica?');
  assert.equal(r.accepted, true);
  assert.equal(r.city, 'Campinas');
  assert.equal(classify('Procuro diarista em Curitiba').city, 'Curitiba');
});
