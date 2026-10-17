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
