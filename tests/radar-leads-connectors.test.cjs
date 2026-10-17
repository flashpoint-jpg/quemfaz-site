const test = require('node:test');
const assert = require('node:assert/strict');
const { runConnector, parseFeed, stripHtml } = require('../scripts/radar-leads-connectors.cjs');

// Respostas FICTÍCIAS de teste. Nenhuma rede é usada: fetchImpl é injetado.
const reply = (body, status = 200, headers = {}) => async () => ({
  ok: status >= 200 && status < 300, status, headers: { get: k => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body
});

test('lê RSS e Atom e limpa HTML e entidades', () => {
  const rss = `<rss><channel><item><title>Preciso de pintor</title><link>https://forum.teste.invalid/t/1</link>
    <description><![CDATA[<p>Em Santo Andr&eacute; &amp; regi&#227;o</p>]]></description><pubDate>Fri, 16 Oct 2026 12:00:00 GMT</pubDate><guid>g1</guid></item></channel></rss>`;
  const atom = `<feed><entry><title>Procuro diarista</title><link href="https://forum.teste.invalid/t/2"/><summary>Mauá</summary><updated>2026-10-16T10:00:00Z</updated><id>a2</id></entry></feed>`;
  const a = parseFeed(rss), b = parseFeed(atom);
  assert.equal(a.length, 1); assert.equal(a[0].url, 'https://forum.teste.invalid/t/1'); assert.equal(a[0].published_at, '2026-10-16T12:00:00.000Z');
  assert.match(a[0].text, /^Preciso de pintor\. Em Santo Andr/);
  assert.equal(b[0].url, 'https://forum.teste.invalid/t/2');
  assert.equal(stripHtml('a&amp;b &lt;c&gt;'), 'a&b <c>');
  assert.equal(parseFeed('<rss><channel><item><title>x</title><link>https://a.invalid/1</link><pubDate>lixo</pubDate></item></channel></rss>')[0].published_at, null);
});

test('conector RSS devolve itens e rejeita configuração sem https', async () => {
  const ok = await runConnector({ kind: 'rss', config: { feed_url: 'https://forum.teste.invalid/feed.xml' } },
    { fetchImpl: reply('<rss><channel><item><title>t</title><link>https://forum.teste.invalid/t/9</link></item></channel></rss>') });
  assert.equal(ok.seen, 1);
  const bad = await runConnector({ kind: 'rss', config: { feed_url: 'http://forum.teste.invalid/feed.xml' } }, { fetchImpl: reply('') });
  assert.equal(bad.error, 'config_invalida');
});

test('Bluesky: monta o link público do post e remove repetidos entre buscas', async () => {
  const post = { uri: 'at://did:plc:teste/app.bsky.feed.post/3kabc', author: { did: 'did:plc:teste' }, record: { text: 'Preciso de pintor em Mauá', createdAt: '2026-10-16T10:00:00Z' } };
  const calls = [];
  const fetchImpl = async url => { calls.push(String(url)); return reply({ posts: [post] })(); };
  const r = await runConnector({ kind: 'bluesky', config: { queries: ['preciso de pintor', 'procuro pintor'], lang: 'pt' } }, { fetchImpl, env: {} });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].url, 'https://bsky.app/profile/did:plc:teste/post/3kabc');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(u => u.startsWith('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?')));
});

test('bloqueio (401/403/429/5xx) interrompe a fonte e é registrado, sem nova tentativa', async () => {
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return reply('', status, { 'retry-after': '60' })(); };
    const r = await runConnector({ kind: 'bluesky', config: { queries: ['a', 'b', 'c'] } }, { fetchImpl, env: {} });
    assert.equal(r.blocked, true, String(status));
    assert.equal(r.items.length, 0);
    assert.equal(calls, 1, 'não deve insistir depois de um bloqueio');
  }
});

test('Mastodon: só instância e hashtags válidas; extrai texto sem HTML', async () => {
  const list = [{ url: 'https://mastodon.teste.invalid/@a/1', uri: 'u1', content: '<p>Procuro eletricista em Diadema</p>', created_at: '2026-10-16T09:00:00Z' }];
  const r = await runConnector({ kind: 'mastodon', config: { instance: 'mastodon.teste.invalid', hashtags: ['eletricista'] } }, { fetchImpl: reply(list) });
  assert.equal(r.items[0].text, 'Procuro eletricista em Diadema');
  assert.equal((await runConnector({ kind: 'mastodon', config: { instance: 'x/../y', hashtags: ['a'] } }, { fetchImpl: reply([]) })).error, 'config_invalida');
});

test('tipo de fonte desconhecido não executa nada', async () => {
  assert.equal((await runConnector({ kind: 'facebook_grupos', config: {} }, {})).error, 'tipo_nao_suportado');
});
