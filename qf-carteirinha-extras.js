/* QuemFaz — carteirinha: profissão, compartilhar, baixar PDF. Só é ligado pela carteirinha.html com a chave
   `pedidos_valor_definido` ativa. Sem dependências: o PDF é montado aqui (1 página com 1 imagem JPEG). */
(function (global) {
  'use strict';

  function ascii(s) { var o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }
  function concat(parts) {
    var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
    return out;
  }

  // jpeg: Uint8Array de um JPEG; w/h em pixels; page: tamanho da página em pontos.
  function jpegToPdf(jpeg, w, h, pageW, pageH) {
    pageW = pageW || 298; pageH = pageH || 420;
    if (!jpeg || !jpeg.length || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) throw new Error('imagem JPEG inválida');
    var parts = [], offsets = [], len = 0;
    function push(u8) { parts.push(u8); len += u8.length; }
    function obj(n, dict, stream) {
      offsets[n] = len;
      push(ascii(n + ' 0 obj\n' + dict + (stream ? '\nstream\n' : '\nendobj\n')));
      if (stream) { push(stream); push(ascii('\nendstream\nendobj\n')); }
    }
    push(ascii('%PDF-1.4\n'));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageW + ' ' + pageH + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
    obj(4, '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
    var content = 'q ' + pageW + ' 0 0 ' + pageH + ' 0 0 cm /Im0 Do Q';
    obj(5, '<< /Length ' + content.length + ' >>', ascii(content));
    var xref = len, i, pad = function (n) { return ('0000000000' + n).slice(-10); };
    var x = 'xref\n0 6\n0000000000 65535 f \n';
    for (i = 1; i <= 5; i++) x += pad(offsets[i]) + ' 00000 n \n';
    x += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    push(ascii(x));
    return concat(parts);
  }

  function dataUrlToBytes(url) {
    var b = String(url).split(',')[1] || '';
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function profissaoTexto(especialidades) {
    var l = (Array.isArray(especialidades) ? especialidades : []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    if (!l.length) return '';
    return l.slice(0, 2).join(' · ');
  }

  function nomeArquivo(nome) {
    var s = String(nome || 'profissional').normalize ? String(nome || 'profissional').normalize('NFD').replace(/[̀-ͯ]/g, '') : String(nome || 'profissional');
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    return 'carteirinha-quemfaz-' + (s || 'profissional') + '.pdf';
  }

  function linkAvaliacao(origin, token) { return String(origin || '').replace(/\/+$/, '') + '/avaliar.html?token=' + encodeURIComponent(token); }
  function linkWhatsapp(texto) { return 'https://wa.me/?text=' + encodeURIComponent(texto); }

  var api = { jpegToPdf: jpegToPdf, dataUrlToBytes: dataUrlToBytes, profissaoTexto: profissaoTexto, nomeArquivo: nomeArquivo, linkAvaliacao: linkAvaliacao, linkWhatsapp: linkWhatsapp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.QFCarteirinhaExtras = api;
})(typeof window !== 'undefined' ? window : globalThis);
