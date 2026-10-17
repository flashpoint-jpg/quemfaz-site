/**
 * Radar de Leads Externos — classificação determinística inicial.
 * Entrada somente de conectores autorizados. Não publica chamados.
 */
const SERVICES = [
  ['pintor', /\b(pintor|pintura|pintar|pintando)\b/i],
  ['eletricista', /\b(eletricista|tomada|disjuntor|instalação elétrica)\b/i],
  ['encanador', /\b(encanador|vazamento|torneira|cano)\b/i],
  ['diarista', /\b(diarista|faxineira|faxina|limpeza residencial)\b/i],
  ['limpeza de sofá', /\b(sofá|estofado|higienização)\b/i],
  ['montador de móveis', /\b(montador|montagem de móveis|guarda-roupa)\b/i],
];
const CITIES = ['Santo André', 'São Bernardo do Campo', 'São Caetano do Sul', 'Diadema', 'Mauá', 'Ribeirão Pires', 'Rio Grande da Serra'];
const INTENT = /\b(preciso|procuro|procurando|alguém indica|indicação|contratar|orçamento|recomenda)\b/i;
function normalize(text) { return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function classifyLead(record) {
  if (!record || record.authorizedSource !== true || !/^https:\/\//i.test(record.url || '')) return { accepted: false, reason: 'fonte_nao_autorizada' };
  const body = String(record.text || '').slice(0, 3000);
  const plain = normalize(body);
  const service = SERVICES.find(([, rx]) => rx.test(plain));
  const city = CITIES.find(name => plain.includes(normalize(name)));
  const intent = INTENT.test(plain);
  return {
    accepted: Boolean(service && city && intent),
    reason: !service ? 'servico_nao_identificado' : !city ? 'fora_da_regiao' : !intent ? 'sem_intencao_clara' : 'oportunidade',
    service: service?.[0] || null,
    city: city || null,
    source: String(record.source || '').slice(0, 100),
    source_url: record.url,
    excerpt: body.slice(0, 500),
    status: 'novo',
    consent_status: 'nao_verificado'
  };
}
module.exports = { classifyLead };
