const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareExternalLead } = require('../scripts/radar-leads-intake.cjs');
const approved = [{ id:'forum_permitido', allowedHost:'forum.example.org', enabled:true }];
test('aceita fonte permitida e remove parâmetros de campanha', () => {
 const result = prepareExternalLead({ source:'forum_permitido', url:'https://forum.example.org/post/1?utm_source=abc', text:'Preciso de pintor em Santo André' }, approved);
 assert.equal(result.accepted,true);
 assert.equal(result.source_url,'https://forum.example.org/post/1');
 assert.equal(result.status,'novo');
});
test('bloqueia domínio não aprovado', () => {
 assert.equal(prepareExternalLead({ source:'forum_permitido', url:'https://outro.example.org/post/1', text:'Preciso de pintor em Santo André' },approved).accepted,false);
});
test('não converte lead em pedido automaticamente', () => {
 const result=prepareExternalLead({source:'forum_permitido',url:'https://forum.example.org/post/2',text:'Procuro eletricista em Diadema'},approved);
 assert.equal(result.accepted,true);
 assert.equal(result.consent_status,'nao_verificado');
 assert.equal('chamado_id' in result,false);
});
