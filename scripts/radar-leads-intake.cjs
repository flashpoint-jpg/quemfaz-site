'use strict';
const { classifyLead } = require('./radar-leads-classifier.cjs');
/**
 * Prepara registros para ingestão pelo backend autenticado.
 * Não faz requisições externas, não envia mensagens e não cria chamados.
 * A fonte deve ter sido aprovada pelo operador antes da coleta.
 */
function hostOf(value) {
  try { return new URL(value).hostname; } catch { return null; }
}
function prepareExternalLead(item, approvedSources) {
  if (!item || !Array.isArray(approvedSources)) return { accepted: false, reason: 'entrada_invalida' };
  const host = hostOf(item.url);
  const approved = approvedSources.some(source =>
    source && source.enabled === true &&
    source.id === item.source &&
    source.allowedHost === host
  );
  if (!approved) return { accepted: false, reason: 'fonte_nao_aprovada' };
  const result = classifyLead({ ...item, authorizedSource: true });
  if (!result.accepted) return result;
  const url = new URL(item.url);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  return {
    ...result,
    source_url: url.toString(),
    source_item_id: item.id ? String(item.id).slice(0, 200) : null,
    published_at: item.published_at || null,
    status: 'novo',
    consent_status: 'nao_verificado'
  };
}
module.exports = { prepareExternalLead };
