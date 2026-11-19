// Envia somente URLs públicas atualizadas, existentes no sitemap indexável.
// Uso: node scripts/submit-indexnow.cjs / /servicos/pintor/sao-paulo/
const fs = require('node:fs');
const path = require('node:path');

const host = 'quemfazservico.com.br';
const origin = `https://${host}`;
const key = '7d7b57f042cf239a04ef4e6c8d1feefc';
const keyLocation = `${origin}/${key}.txt`;
const root = path.join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const requested = process.argv.slice(2).filter(arg => arg !== '--dry-run');

async function main() {
  if (!requested.length) throw new Error('Informe as URLs alteradas. Nenhum envio automático de todo o sitemap.');
  if (fs.readFileSync(path.join(root, `${key}.txt`), 'utf8').trim() !== key) throw new Error('Chave de domínio inválida.');
  const sitemap = fs.readFileSync(path.join(root, 'dist', 'sitemap.xml'), 'utf8');
  const permitted = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]));
  const urlList = [...new Set(requested.map(input => {
    const url = new URL(input, origin);
    if (url.origin !== origin || url.search || url.hash || !permitted.has(url.href)) throw new Error(`URL fora do sitemap indexável: ${input}`);
    const file = path.join(root, 'dist', decodeURIComponent(url.pathname), 'index.html');
    const html = fs.readFileSync(file, 'utf8');
    if (/<meta name="robots" content="noindex/i.test(html)) throw new Error(`Página noindex: ${input}`);
    return url.href;
  }))];
  if (dryRun) return console.log(JSON.stringify({host, keyLocation, urlList}, null, 2));
  // Evita anunciar páginas antes da atualização estar publicada no domínio.
  const verification = await fetch(keyLocation);
  if (!verification.ok || (await verification.text()).trim() !== key) throw new Error('Arquivo IndexNow ainda não está publicado no domínio.');
  const response = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: {'content-type': 'application/json; charset=utf-8'},
    body: JSON.stringify({host, key, keyLocation, urlList})
  });
  if (![200, 202].includes(response.status)) throw new Error(`IndexNow HTTP ${response.status}: ${(await response.text()).slice(0,300)}`);
  console.log(`IndexNow HTTP ${response.status}; ${urlList.length} URLs aceitas para processamento.`);
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
