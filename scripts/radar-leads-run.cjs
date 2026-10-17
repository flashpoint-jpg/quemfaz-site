'use strict';
/**
 * Radar de Leads Externos — executor periódico (roda no GitHub Actions ou em qualquer servidor).
 *
 *   node scripts/radar-leads-run.cjs            # captura e grava em staging (qf_leads_externos)
 *   node scripts/radar-leads-run.cjs --dry-run  # captura e classifica, sem gravar nada
 *   node scripts/radar-leads-run.cjs --force    # ignora o intervalo mínimo entre rodadas da fonte
 *
 * Variáveis: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (segredos do servidor; nunca no navegador).
 * Só processa fontes habilitadas em qf_lead_sources (exigem prova de autorização). Sem fonte habilitada,
 * não faz nada. Nunca cria pedidos, notificações ou cobranças: só grava oportunidades em staging.
 */
const { runConnector } = require('./radar-leads-connectors.cjs');
const { prepareExternalLead } = require('./radar-leads-intake.cjs');

function makeRpc(baseUrl, key, fetchImpl = fetch) {
  return async function rpc(name, args) {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(args || {}),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`rpc_${name}_http_${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

function dueForRun(source, now, force) {
  if (force || !source.last_run_at) return true;
  const waited = (now - Date.parse(source.last_run_at)) / 60000;
  return waited >= Number(source.rate_limit_minutes || 180);
}

async function processSource(source, { rpc, dryRun, deps }) {
  const approved = [{ id: source.id, enabled: true, allowedHost: source.allowed_host }];
  const captured = await runConnector(source, deps);
  const ready = [];
  const rejected = {};
  let ofertas = 0;
  for (const item of captured.items) {
    const prepared = prepareExternalLead({ ...item, source: source.id }, approved);
    if (prepared.accepted) {
      ready.push({
        source: source.id, source_url: prepared.source_url, source_item_id: prepared.source_item_id,
        intent: prepared.intent, service: prepared.service, service_slug: prepared.service_slug,
        city: prepared.city, neighborhood: prepared.neighborhood, urgency: prepared.urgency,
        confidence: prepared.confidence, excerpt: prepared.excerpt, published_at: prepared.published_at
      });
    } else if (prepared.reason === 'possivel_oferta') {
      ofertas += 1;
    } else {
      rejected[prepared.reason] = (rejected[prepared.reason] || 0) + 1;
    }
  }
  let ingest = null;
  if (!dryRun && ready.length) {
    for (let i = 0; i < ready.length; i += 100) {
      const part = await rpc('qf_radar_ingest', { p_items: ready.slice(i, i + 100) });
      ingest = ingest ? Object.fromEntries(Object.keys(part).map(k => [k, (ingest[k] || 0) + part[k]])) : part;
    }
  }
  const status = captured.blocked ? 'bloqueada' : captured.error ? 'erro' : 'ok';
  if (!dryRun) await rpc('qf_radar_fonte_resultado', { p_id: source.id, p_status: status, p_erro: captured.error || null, p_vistos: captured.seen });
  return { source: source.id, status, error: captured.error || null, vistos: captured.seen, candidatos: ready.length,
    ofertas_descartadas: ofertas, rejeitados: rejected, gravacao: ingest, dry_run: !!dryRun };
}

async function main(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(JSON.stringify({ executado: false, motivo: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: nada foi coletado.' }));
    return { executado: false };
  }
  const rpc = deps.rpc || makeRpc(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const sources = (await rpc('qf_radar_fontes_ativas', {})) || [];
  if (!sources.length) {
    console.log(JSON.stringify({ executado: true, fontes_habilitadas: 0, motivo: 'Nenhuma fonte externa habilitada com autorização registrada.' }));
    return { executado: true, fontes: [] };
  }
  const now = Date.now();
  const report = [];
  for (const source of sources) {
    if (!dueForRun(source, now, force)) { report.push({ source: source.id, status: 'aguardando_intervalo' }); continue; }
    report.push(await processSource(source, { rpc, dryRun, deps }));
  }
  console.log(JSON.stringify({ executado: true, fontes: report }, null, 2));
  return { executado: true, fontes: report };
}

if (require.main === module) main().catch(error => { console.error(String(error && error.message || error)); process.exit(1); });
module.exports = { main, processSource, dueForRun, makeRpc };
