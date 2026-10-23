const test=require('node:test'),assert=require('node:assert/strict');
const {oferta}=require('../qf-livre.js');
test('Livre: ativo, vencido e contratação sem ativação pelo cliente',()=>{
 assert.match(oferta(),/Assinar por R\$ 39,90/);
 assert.match(oferta(),/13%/);
 const active=oferta({ativo:true,valido_ate:'2026-12-01T10:00:00Z'});
 assert.match(active,/Plano ativo — desbloqueios ilimitados/);assert.doesNotMatch(active,/data-qf-livre-pagar/);
 assert.match(oferta({ativo:false,valido_ate:'2026-10-01T10:00:00Z'}),/Plano vencido em/);
});
