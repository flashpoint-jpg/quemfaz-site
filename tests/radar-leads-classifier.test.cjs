const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyLead } = require('../scripts/radar-leads-classifier.cjs');
test('identifica pedido autorizado em Santo André', () => {
 const r = classifyLead({ authorizedSource: true, url: 'https://example.org/p/1', source: 'forum_permitido', text: 'Preciso de pintor em Santo André esta semana' });
 assert.equal(r.accepted, true); assert.equal(r.service, 'pintor'); assert.equal(r.city, 'Santo André');
});
test('recusa fonte não autorizada', () => {
 const r = classifyLead({ authorizedSource: false, url: 'https://example.org/p/2', text: 'Preciso de pintor em Santo André' });
 assert.equal(r.accepted, false);
});
test('não aceita oferta de serviços como pedido', () => {
 const r = classifyLead({ authorizedSource: true, url: 'https://example.org/p/3', text: 'Sou pintor em Santo André, ofereço meus serviços' });
 assert.equal(r.accepted, false);
});
test('não aceita cidade fora do ABC', () => {
 const r = classifyLead({ authorizedSource: true, url: 'https://example.org/p/4', text: 'Preciso de pintor em Pequenópolis' });
 assert.equal(r.accepted, false);
});
