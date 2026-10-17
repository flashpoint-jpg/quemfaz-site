// @ts-nocheck
// GERADO por scripts/build-radar-edge.cjs — não editar à mão.
// Coleta automática do Radar de Leads Externos (só fontes habilitadas e autorizadas em qf_lead_sources).
const __defs: Record<string, (module: any, exports: any, require: any) => void> = {};
const __cache: Record<string, any> = {};
const __req = (k: string) => { if (!__cache[k]) { const m = { exports: {} }; __cache[k] = m; __defs[k](m, m.exports, __req); } return __cache[k].exports; };
__defs["./radar-leads-classifier.cjs"] = (module, exports, require) => {
/* Radar de Leads Externos — classificador conservador (Node e navegador).
   Não publica pedidos, não contata ninguém e não processa fontes não autorizadas.
   Só aceita texto de fonte aprovada; remove e-mail, telefone, CPF e @usuários do trecho guardado. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFRadarClassifier = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // slug = valor aceito pelo parâmetro ?servico= do formulário existente (qf-client-acquisition.js).
  var SERVICES = [
    { label: 'limpeza de sofá', slug: 'limpeza_sofa', phrase: 'limpeza de sofá',
      re: /\b(limp\w*|lav\w*|higieniz\w*)( \w+){0,2} (sofa|sofas|estofado|estofados|colchao)\b|\b(sofa|estofado)s? (sujo|manchado)|higienizacao/ },
    { label: 'faxina pós-obra', slug: 'faxina_pos_obra', phrase: 'faxina pós-obra',
      re: /\b(faxina|limpeza) pos obra\b|\bpos obra\b/ },
    { label: 'pintor', slug: 'pintor', phrase: 'um pintor', re: /\b(pintor|pintora|pintura|pintar|pintando)\b/ },
    { label: 'eletricista', slug: 'eletricista', phrase: 'um eletricista',
      re: /\b(eletricista|tomada|tomadas|disjuntor|instalacao eletrica|curto circuito|fiacao)\b/ },
    { label: 'encanador', slug: 'encanador', phrase: 'um encanador',
      re: /\b(encanador|vazamento|torneira|cano estourado|hidraulica|hidraulico)\b/ },
    { label: 'desentupidor', slug: 'desentupidor', phrase: 'um desentupidor', re: /\b(desentup\w+|entupid\w+)\b/ },
    { label: 'diarista', slug: 'diarista', phrase: 'uma diarista',
      re: /\b(diarista|faxineira|faxina|limpeza residencial)\b/ },
    { label: 'montador de móveis', slug: 'montador', phrase: 'um montador de móveis',
      re: /\b(montador|montagem de (moveis|movel|guarda roupa|cozinha|armario)|montar (um |uns |o |os |meu |meus |minha |minhas )?(moveis|movel|guarda roupa|armario|cama|rack|cozinha|estante|painel))\b/ },
    { label: 'pedreiro', slug: 'pedreiro', phrase: 'um pedreiro', re: /\b(pedreiro|alvenaria|reboco)\b/ },
    { label: 'telhadista', slug: 'telhadista', phrase: 'um telhadista', re: /\b(telhadista|telhado|telhas?|calha|goteira)\b/ },
    { label: 'chaveiro', slug: 'chaveiro', phrase: 'um chaveiro',
      re: /\b(chaveiro|fechadura|chave (quebrou|presa|trancada)|perdi (a |minha )?chave)\b/ },
    { label: 'antenista', slug: 'antenista', phrase: 'um antenista', re: /\b(antenista|antena)\b/ },
    { label: 'marido de aluguel', slug: 'marido_aluguel', phrase: 'um marido de aluguel', re: /\bmarido de aluguel\b/ },
    { label: 'gesseiro', slug: 'gesseiro', phrase: 'um gesseiro', re: /\b(gesseiro|forro de gesso|drywall)\b/ },
    { label: 'azulejista', slug: 'azulejista', phrase: 'um azulejista', re: /\b(azulejista|assentar (azulejo|porcelanato|piso))\b/ },
    { label: 'impermeabilização', slug: 'impermeabilizacao', phrase: 'impermeabilização', re: /\b(impermeabiliz\w+|infiltracao)\b/ },
    { label: 'limpeza de caixa d’água', slug: 'caixa_dagua', phrase: 'limpeza de caixa d’água', re: /\bcaixa d ?agua\b/ }
  ];

  // Grande ABC. Os apelidos são comparados sem acento e em minúsculas.
  var CITIES = [
    { name: 'Santo André', aliases: ['santo andre', 'sto andre'] },
    { name: 'São Bernardo do Campo', aliases: ['sao bernardo do campo', 'sao bernardo', 'sbc'] },
    { name: 'São Caetano do Sul', aliases: ['sao caetano do sul', 'sao caetano'] },
    { name: 'Diadema', aliases: ['diadema'] },
    { name: 'Mauá', aliases: ['maua'] },
    { name: 'Ribeirão Pires', aliases: ['ribeirao pires'] },
    { name: 'Rio Grande da Serra', aliases: ['rio grande da serra'] }
  ];

  // Só bairros inequívocos (nomes que existem em uma única cidade da região).
  var NEIGHBORHOODS = {
    'Santo André': ['vila assuncao', 'campestre', 'vila pires', 'parque das nacoes', 'vila luzita', 'utinga', 'vila humaita',
      'jardim bela vista', 'vila alpina', 'parque capuava', 'jardim do estadio', 'vila guiomar', 'bangu', 'vila scarpelli',
      'parque novo oratorio', 'vila metalurgica'],
    'São Bernardo do Campo': ['rudge ramos', 'baeta neves', 'jardim do mar', 'planalto', 'ferrazopolis', 'nova petropolis',
      'santa terezinha', 'vila euclides', 'demarchi', 'riacho grande', 'alvarenga', 'batistini', 'montanhao', 'paulicea'],
    'São Caetano do Sul': ['santa paula', 'barcelona', 'fundacao', 'olimpico', 'osvaldo cruz', 'oswaldo cruz', 'nova gerty', 'prosperidade'],
    'Diadema': ['eldorado', 'serraria', 'canhema', 'piraporinha', 'inamar', 'vila nogueira', 'jardim ruyce', 'casa grande'],
    'Mauá': ['vila noemia', 'parque sao vicente', 'jardim zaira', 'vila bocaina', 'vila magini', 'jardim pilar', 'sonia maria'],
    'Ribeirão Pires': ['ouro fino paulista', 'suisso'],
    'Rio Grande da Serra': []
  };

  var NEED_VERBS = ['preciso', 'precisando', 'procuro', 'procurando', 'quero contratar', 'gostaria de contratar',
    'alguem indica', 'alguem conhece', 'alguem sabe de', 'alguem recomenda', 'alguem que faca', 'alguem que faz',
    'tem alguem', 'indica um', 'indica uma', 'indicar um', 'indicar uma'];
  var INTENTS = NEED_VERBS.concat(['indicacao', 'contratar', 'orcamento', 'recomenda', 'recomendam', 'quanto custa']);
  var OFFER = ['sou pintor', 'sou pintora', 'sou eletricista', 'sou encanador', 'sou diarista', 'sou pedreiro', 'sou chaveiro',
    'ofereco meus servicos', 'ofereco servicos', 'prestamos servicos', 'presto servicos', 'contrate nossos', 'contrate meus',
    'faco servicos', 'fazemos', 'atendo toda', 'atendemos', 'orcamento sem compromisso', 'chama no whats', 'chame no whats',
    'chame no zap', 'trabalho com', 'servico de qualidade', 'anos de experiencia', 'divulgacao'];
  var URGENT = ['urgente', 'urgencia', 'ainda hoje', 'hoje', 'agora', 'o quanto antes', 'amanha', 'emergencia', 'para ja', 'vazando'];

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function containsPhrase(haystack, needle) {
    return (' ' + haystack + ' ').indexOf(' ' + normalize(needle) + ' ') !== -1;
  }
  function containsAny(haystack, list) {
    for (var i = 0; i < list.length; i++) if (containsPhrase(haystack, list[i])) return true;
    return false;
  }

  var CONTACT_RE = /(\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|wa\.me\/|whatsapp\.com\/|chat\.whatsapp/i;

  // Mesma regra aplicada pelo banco (private.qf_radar_redact); o banco refaz a limpeza por segurança.
  function redact(text) {
    return String(text == null ? '' : text)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail removido]')
      .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[documento removido]')
      .replace(/(\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g, '[telefone removido]')
      .replace(/(^|\s)@[A-Za-z0-9_.]{2,}/g, '$1[usuário removido]')
      .trim().slice(0, 500);
  }

  function findService(plain) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].re.test(plain)) return SERVICES[i];
    return null;
  }
  function findCity(plain) {
    for (var i = 0; i < CITIES.length; i++) {
      if (containsAny(plain, CITIES[i].aliases)) return CITIES[i].name;
    }
    return null;
  }
  function findNeighborhood(plain, city) {
    var names = Object.keys(NEIGHBORHOODS);
    for (var i = 0; i < names.length; i++) {
      if (city && names[i] !== city) continue;
      var list = NEIGHBORHOODS[names[i]];
      for (var j = 0; j < list.length; j++) {
        if (containsPhrase(plain, list[j])) return { city: names[i], name: list[j] };
      }
    }
    return null;
  }
  function titleCase(text) {
    return text.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).replace(/\b(De|Da|Do|Das|Dos)\b/g, function (c) { return c.toLowerCase(); });
  }

  /**
   * record: { authorizedSource: true, url, source, text }
   * Retorna sempre um objeto; `accepted` só é true para pedido real de contratação na região.
   */
  function classifyLead(record) {
    if (!record || record.authorizedSource !== true) return { accepted: false, reason: 'fonte_nao_autorizada' };
    var url;
    try { url = new URL(record.url); } catch (e) { return { accepted: false, reason: 'url_invalida' }; }
    if (url.protocol !== 'https:' || !url.hostname) return { accepted: false, reason: 'url_invalida' };

    var body = String(record.text || '').slice(0, 3000);
    var plain = normalize(body);
    var service = findService(plain);
    var city = findCity(plain);
    var hood = findNeighborhood(plain, city);
    if (!city && hood) city = hood.city;
    var needs = containsAny(plain, NEED_VERBS);
    var intent = containsAny(plain, INTENTS);
    var hasContact = CONTACT_RE.test(body);
    var asksQuestion = body.indexOf('?') !== -1;
    var isOffer = containsAny(plain, OFFER) || (hasContact && !needs && !asksQuestion);

    var reason = !service ? 'servico_nao_identificado'
      : !city ? 'fora_da_regiao'
      : isOffer ? 'possivel_oferta'
      : !intent ? 'sem_intencao_clara' : 'oportunidade';

    var urgency = containsAny(plain, URGENT) ? 'urgente' : null;
    var confidence = 0.5 + (needs ? 0.15 : 0) + (asksQuestion ? 0.1 : 0) + (hood ? 0.1 : 0) + (urgency ? 0.1 : 0)
      + (plain.length >= 40 ? 0.05 : 0) - (hasContact ? 0.1 : 0);
    confidence = Math.round(Math.max(0, Math.min(0.95, confidence)) * 100) / 100;

    return {
      accepted: reason === 'oportunidade',
      reason: reason,
      intent: reason === 'possivel_oferta' ? 'oferta_servico' : (reason === 'oportunidade' ? 'procura_profissional' : 'indefinido'),
      service: service ? service.label : null,
      service_slug: service ? service.slug : null,
      city: city || null,
      neighborhood: hood ? titleCase(hood.name) : null,
      urgency: urgency,
      confidence: confidence,
      source: String(record.source || '').slice(0, 100),
      source_url: url.toString(),
      excerpt: redact(body),
      status: 'novo',
      consent_status: 'nao_verificado'
    };
  }

  function inviteMessage(serviceLabel, link) {
    var item = null;
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].label === serviceLabel || SERVICES[i].slug === serviceLabel) item = SERVICES[i];
    var what = item ? item.phrase : 'um profissional';
    return 'Está procurando ' + what + '? Publique seu pedido gratuitamente no Quem Faz e receba até 4 contatos de profissionais da sua região. ' + link;
  }

  return { classifyLead: classifyLead, inviteMessage: inviteMessage, normalize: normalize, redact: redact,
    SERVICES: SERVICES, CITIES: CITIES };
});

};
__defs["./radar-leads-intake.cjs"] = (module, exports, require) => {
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

};
__defs["./radar-leads-connectors.cjs"] = (module, exports, require) => {
'use strict';
/**
 * Radar de Leads Externos — conectores de fontes com acesso e coleta autorizados.
 *
 * Regras (não negociáveis):
 *  - só APIs/feeds públicos e documentados; nenhum login falso, CAPTCHA, scraping de página ou grupo privado;
 *  - qualquer bloqueio (401/403/429/5xx) interrompe a fonte naquela rodada e é registrado — nunca contornado;
 *  - nenhum perfil, nome de exibição, telefone ou e-mail é coletado além do que está no texto público do pedido
 *    (e o texto ainda passa por remoção de dados pessoais antes de ser guardado);
 *  - cada conector recebe `fetchImpl` por injeção para ser testado sem rede.
 *
 * Todo conector devolve { items: [{ id, url, text, published_at }], seen, blocked, error }.
 */
const UA = 'QuemFazRadar/1.0 (+https://quemfazservico.com.br)';

class SourceBlocked extends Error {
  constructor(status, detail) { super(`bloqueada:${status}${detail ? ' ' + detail : ''}`); this.status = status; }
}

async function request(fetchImpl, url, { headers = {}, timeoutMs = 15000, maxBytes = 2_000_000 } = {}) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': UA, accept: 'application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9', ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow'
  });
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500) {
    throw new SourceBlocked(res.status, res.status === 429 ? `retry-after=${res.headers && res.headers.get && res.headers.get('retry-after')}` : '');
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const text = await res.text();
  if (text.length > maxBytes) throw new Error('resposta_grande_demais');
  return text;
}

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function stripHtml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return entities[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ').trim();
}

/** RSS 2.0 e Atom. config: { feed_url } */
function parseFeed(xml) {
  const items = [];
  const blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const pick = tag => { const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block); return m ? m[1] : ''; };
    let link = stripHtml(pick('link'));
    if (!link) { const m = /<link[^>]*href=["']([^"']+)["']/i.exec(block); link = m ? m[1] : ''; }
    const title = stripHtml(pick('title'));
    const body = stripHtml(pick('description') || pick('summary') || pick('content'));
    const when = stripHtml(pick('pubDate') || pick('updated') || pick('published'));
    const id = stripHtml(pick('guid') || pick('id')) || link;
    if (!link) continue;
    const date = when ? new Date(when) : null;
    items.push({
      id, url: link, text: [title, body].filter(Boolean).join('. '),
      published_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null
    });
  }
  return items;
}

async function rssConnector(config, { fetchImpl = fetch } = {}) {
  if (!config || !/^https:\/\//.test(config.feed_url || '')) return { items: [], seen: 0, error: 'config_invalida' };
  const xml = await request(fetchImpl, config.feed_url);
  const items = parseFeed(xml);
  return { items, seen: items.length };
}

/**
 * Bluesky (AT Protocol) — busca pública oficial de posts.
 * config: { queries: [...], lang: 'pt', limit: 25 }
 * Sem credenciais usa o endpoint público; se ele exigir autenticação a fonte é registrada como bloqueada.
 * Com BSKY_HANDLE e BSKY_APP_PASSWORD (senha de app da própria conta) autentica pela API oficial.
 */
async function blueskyConnector(config, { fetchImpl = fetch, env = process.env } = {}) {
  const queries = (config && Array.isArray(config.queries) ? config.queries : []).slice(0, 12);
  if (!queries.length) return { items: [], seen: 0, error: 'config_invalida' };
  let base = 'https://public.api.bsky.app', headers = {};
  if (env.BSKY_HANDLE && env.BSKY_APP_PASSWORD) {
    const res = await fetchImpl('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }),
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new SourceBlocked(res.status, 'login');
    const session = await res.json();
    base = 'https://bsky.social'; headers = { authorization: `Bearer ${session.accessJwt}` };
  }
  const seen = new Map();
  for (const q of queries) {
    const params = new URLSearchParams({ q, limit: String(Math.min(Number(config.limit) || 25, 50)), sort: 'latest' });
    if (config.lang) params.set('lang', config.lang);
    const body = JSON.parse(await request(fetchImpl, `${base}/xrpc/app.bsky.feed.searchPosts?${params}`, { headers }));
    for (const post of body.posts || []) {
      const rkey = String(post.uri || '').split('/').pop();
      const did = post.author && post.author.did;
      if (!rkey || !did || !post.record || !post.record.text) continue;
      const url = `https://bsky.app/profile/${did}/post/${rkey}`;
      if (!seen.has(url)) seen.set(url, { id: post.uri, url, text: post.record.text, published_at: post.record.createdAt || null });
    }
  }
  const items = [...seen.values()];
  return { items, seen: items.length };
}

/** Mastodon — linha do tempo pública de hashtags (API pública da própria instância). config: { instance, hashtags } */
async function mastodonConnector(config, { fetchImpl = fetch } = {}) {
  const instance = config && /^[a-z0-9.-]+$/i.test(config.instance || '') ? config.instance.toLowerCase() : null;
  const tags = (config && Array.isArray(config.hashtags) ? config.hashtags : []).filter(t => /^[\p{L}\p{N}_]+$/u.test(t)).slice(0, 12);
  if (!instance || !tags.length) return { items: [], seen: 0, error: 'config_invalida' };
  const seen = new Map();
  for (const tag of tags) {
    const list = JSON.parse(await request(fetchImpl, `https://${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`));
    for (const status of Array.isArray(list) ? list : []) {
      if (!status.url || !status.content) continue;
      if (!seen.has(status.url)) seen.set(status.url, { id: status.uri || status.url, url: status.url, text: stripHtml(status.content), published_at: status.created_at || null });
    }
  }
  const items = [...seen.values()];
  return { items, seen: items.length };
}

const CONNECTORS = { rss: rssConnector, bluesky: blueskyConnector, mastodon: mastodonConnector };

async function runConnector(source, deps = {}) {
  const connector = CONNECTORS[source && source.kind];
  if (!connector) return { items: [], seen: 0, error: 'tipo_nao_suportado' };
  try {
    return await connector(source.config || {}, deps);
  } catch (error) {
    if (error instanceof SourceBlocked) return { items: [], seen: 0, blocked: true, error: error.message };
    return { items: [], seen: 0, error: String(error && error.message || error).slice(0, 200) };
  }
}

module.exports = { runConnector, parseFeed, stripHtml, rssConnector, blueskyConnector, mastodonConnector, SourceBlocked };

};
__defs["./radar-leads-run.cjs"] = (module, exports, require) => {
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

module.exports = { main, processSource, dueForRun, makeRpc };

};

const run = __req('./radar-leads-run.cjs');
Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('metodo', { status: 405 });
  const url = new URL(req.url);
  const env = { SUPABASE_URL: Deno.env.get('SUPABASE_URL'), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') };
  const argv = [];
  if (url.searchParams.get('dry_run') === '1') argv.push('--dry-run');
  // A função respeita o intervalo mínimo de cada fonte; --force só vale para dry-run (não grava nada).
  if (url.searchParams.get('force') === '1' && url.searchParams.get('dry_run') === '1') argv.push('--force');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const result = await run.main(argv, env, { env: {} });
    console.log = orig;
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.log = orig;
    return new Response(JSON.stringify({ erro: String(e && e.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
