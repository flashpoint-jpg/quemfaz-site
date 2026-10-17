/**
 * Radar de Leads Externos: classificador conservador.
 * Não publica chamados, não contata pessoas e não processa fontes não autorizadas.
 */
const SERVICES = [
 ['pintor', ['pintor','pintura','pintar','pintando']],
 ['eletricista', ['eletricista','tomada','disjuntor','instalacao eletrica']],
 ['encanador', ['encanador','vazamento','torneira','cano']],
 ['diarista', ['diarista','faxineira','faxina','limpeza residencial']],
 ['limpeza de sofá', ['sofa','estofado','higienizacao']],
 ['montador de móveis', ['montador','montagem de moveis','guarda roupa']]
];
const CITIES = ['Santo André','São Bernardo do Campo','São Caetano do Sul','Diadema','Mauá','Ribeirão Pires','Rio Grande da Serra'];
const INTENTS = ['preciso','procuro','procurando','alguem indica','indicacao','contratar','orcamento','recomenda'];
const OFFER = ['sou pintor','sou eletricista','sou encanador','ofereco meus servicos','prestamos servicos','contrate nossos'];
function normalize(value) {
 return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function containsPhrase(haystack, needle) {
 return (' ' + haystack + ' ').includes(' ' + normalize(needle) + ' ');
}
function classifyLead(record) {
 if (!record || record.authorizedSource !== true) return { accepted:false, reason:'fonte_nao_autorizada' };
 let url;
 try { url = new URL(record.url); } catch { return { accepted:false, reason:'url_invalida' }; }
 if (url.protocol !== 'https:' || !url.hostname) return { accepted:false, reason:'url_invalida' };
 const body = String(record.text || '').slice(0,3000);
 const plain = normalize(body);
 const service = SERVICES.find(([, terms]) => terms.some(term => containsPhrase(plain,term)));
 const city = CITIES.find(name => containsPhrase(plain,name));
 const intent = INTENTS.some(term => containsPhrase(plain,term));
 const isOffer = OFFER.some(term => containsPhrase(plain,term));
 const reason = !service ? 'servico_nao_identificado' : !city ? 'fora_da_regiao' : !intent ? 'sem_intencao_clara' : isOffer ? 'possivel_oferta' : 'oportunidade';
 return { accepted:reason==='oportunidade', reason, service:service?.[0] || null, city:city || null, source:String(record.source || '').slice(0,100), source_url:url.toString(), excerpt:body.slice(0,500), status:'novo', consent_status:'nao_verificado' };
}
module.exports = { classifyLead };
