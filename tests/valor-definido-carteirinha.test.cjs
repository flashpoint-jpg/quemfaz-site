const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const E = require('../qf-carteirinha-extras.js');
const root = path.join(__dirname, '..');
const load = f => fs.readFileSync(path.join(root, f), 'utf8');

// JPEG mínimo válido (1x1) para exercitar o escritor de PDF sem depender de canvas.
const JPEG_1X1 = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCzRRRXzZ9Gf//Z', 'base64'); // JPEG real 8x8 gerado com Pillow

test('PDF da carteirinha: cabeçalho, 5 objetos, xref apontando para os objetos certos', () => {
  const pdf = Buffer.from(E.jpegToPdf(new Uint8Array(JPEG_1X1), 1, 1));
  const txt = pdf.toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  const start = Number(/startxref\n(\d+)/.exec(txt)[1]);
  assert.equal(txt.slice(start, start + 4), 'xref');
  const entries = [...txt.slice(start).matchAll(/(\d{10}) 00000 n /g)].map(m => Number(m[1]));
  assert.equal(entries.length, 5);
  entries.forEach((off, i) => assert.ok(txt.slice(off).startsWith((i + 1) + ' 0 obj'), 'objeto ' + (i + 1)));
  assert.ok(txt.includes('/Filter /DCTDecode'));
});

test('PDF recusa dados que não são JPEG', () => {
  assert.throws(() => E.jpegToPdf(new Uint8Array([1, 2, 3]), 1, 1));
  assert.throws(() => E.jpegToPdf(null, 1, 1));
});

test('PDF abre em qpdf quando disponível', { skip: (() => { try { execFileSync('qpdf', ['--version']); return false; } catch (_) { return true; } })() }, () => {
  const tmp = path.join(require('node:os').tmpdir(), 'qf-test-' + process.pid + '.pdf');
  fs.writeFileSync(tmp, E.jpegToPdf(new Uint8Array(JPEG_1X1), 1, 1));
  try { execFileSync('qpdf', ['--check', tmp], { stdio: 'pipe' }); } finally { fs.rmSync(tmp, { force: true }); }
});

test('profissão, nome do arquivo e links', () => {
  assert.equal(E.profissaoTexto(['Eletricista', 'Encanador', 'Pintor']), 'Eletricista · Encanador');
  assert.equal(E.profissaoTexto([]), '');
  assert.equal(E.profissaoTexto(null), '');
  assert.equal(E.nomeArquivo('José da Silva Ç'), 'carteirinha-quemfaz-jose-da-silva-c.pdf');
  assert.equal(E.nomeArquivo(''), 'carteirinha-quemfaz-profissional.pdf');
  assert.equal(E.linkAvaliacao('https://quemfazservico.com.br/', 'abc'), 'https://quemfazservico.com.br/avaliar.html?token=abc');
  assert.ok(E.linkWhatsapp('oi a&b').startsWith('https://wa.me/?text=oi%20a%26b'));
});

test('carteirinha.html: extras só com a chave ligada; QR continua levando ao avaliar.html do profissional', () => {
  const html = load('carteirinha.html');
  assert.match(html, /qf_pedidos_valor_config/);
  assert.match(html, /cfg\.data\.ativo!==true\)return/);
  assert.match(html, /qf_carteirinha_publica_v2/);
  assert.match(html, /Baixar PDF/);
  assert.match(html, /Compartilhar/);
  assert.match(html, /window\.print\(\)/); // impressão preservada
  assert.match(html, /avaliar\.html\?token=/);
  assert.match(html, /@media print/);
  // Sem a chave, a página estática continua sem profissão (comportamento anterior).
  assert.doesNotMatch(html, /<(?:div|p)[^>]*>Profissão</i);
});

test('o QR da carteirinha identifica só o profissional; o token do pedido nunca vai na carteirinha', () => {
  const html = load('carteirinha.html');
  assert.doesNotMatch(html, /confirmar-servico|qf_solicitar_baixa|conclusao/i);
});
