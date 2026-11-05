/* QuemFaz V12.3.0 — "Onde o QuemFaz já atende": mapa das regiões na home do computador.
   Usa os mesmos números do contador (qf_home_stats: só totais por cidade, sem dado pessoal).
   Sem resposta do banco e sem cache, o cartão não aparece: nunca mostra número inventado.
   Também expõe QFCidadesNorm, que junta nomes digitados diferente (ex.: "sao paulo", "Saopaulo")
   para o contador "Ver cidades" e o mapa contarem a mesma cidade uma vez só. */
(function (g) {
  'use strict';

  // chave -> [nome, latitude, longitude, região]
  var CIDADES = {
    'sao paulo': ['São Paulo', -23.55, -46.63, 'capital'],
    'guarulhos': ['Guarulhos', -23.46, -46.53, 'norte'],
    'sao bernardo do campo': ['São Bernardo do Campo', -23.69, -46.56, 'abc'],
    'praia grande': ['Praia Grande', -24.01, -46.41, 'baixada'],
    'santo andre': ['Santo André', -23.66, -46.53, 'abc'],
    'diadema': ['Diadema', -23.69, -46.62, 'abc'],
    'mogi das cruzes': ['Mogi das Cruzes', -23.52, -46.19, 'leste'],
    'osasco': ['Osasco', -23.53, -46.79, 'oeste'],
    'maua': ['Mauá', -23.67, -46.46, 'abc'],
    'sao vicente': ['São Vicente', -23.96, -46.39, 'baixada'],
    'carapicuiba': ['Carapicuíba', -23.52, -46.84, 'oeste'],
    'jundiai': ['Jundiaí', -23.19, -46.88, ''],
    'ribeirao pires': ['Ribeirão Pires', -23.71, -46.41, 'abc'],
    'suzano': ['Suzano', -23.54, -46.31, 'leste'],
    'taboao da serra': ['Taboão da Serra', -23.61, -46.79, 'oeste'],
    'itaquaquecetuba': ['Itaquaquecetuba', -23.49, -46.35, 'leste'],
    'mongagua': ['Mongaguá', -24.09, -46.62, 'baixada'],
    'embu das artes': ['Embu das Artes', -23.65, -46.85, 'oeste'],
    'santana de parnaiba': ['Santana de Parnaíba', -23.44, -46.92, 'oeste'],
    'santos': ['Santos', -23.96, -46.33, 'baixada'],
    'sao caetano do sul': ['São Caetano do Sul', -23.62, -46.55, 'abc'],
    'barueri': ['Barueri', -23.51, -46.88, 'oeste'],
    'franco da rocha': ['Franco da Rocha', -23.32, -46.73, 'norte'],
    'itanhaem': ['Itanhaém', -24.18, -46.79, 'baixada'],
    'itapecerica da serra': ['Itapecerica da Serra', -23.72, -46.85, 'oeste'],
    'itapevi': ['Itapevi', -23.55, -46.93, 'oeste'],
    'jandira': ['Jandira', -23.53, -46.90, 'oeste'],
    'sao jose dos campos': ['São José dos Campos', -23.22, -45.89, ''],
    'cotia': ['Cotia', -23.60, -46.92, 'oeste'],
    'cajamar': ['Cajamar', -23.35, -46.88, 'norte'],
    'caieiras': ['Caieiras', -23.36, -46.74, 'norte'],
    'cubatao': ['Cubatão', -23.89, -46.42, 'baixada'],
    'guaruja': ['Guarujá', -23.99, -46.26, 'baixada'],
    'ferraz de vasconcelos': ['Ferraz de Vasconcelos', -23.54, -46.37, 'leste'],
    'campo limpo paulista': ['Campo Limpo Paulista', -23.21, -46.79, ''],
    'itu': ['Itu', -23.26, -47.30, ''],
    'salto': ['Salto', -23.20, -47.29, ''],
    'jacarei': ['Jacareí', -23.30, -45.97, ''],
    'embu guacu': ['Embu-Guaçu', -23.83, -46.81, 'oeste'],
    'rio grande da serra': ['Rio Grande da Serra', -23.74, -46.40, 'abc'],
    'mairinque': ['Mairinque', -23.54, -47.18, ''],
    'vargem grande paulista': ['Vargem Grande Paulista', -23.60, -47.02, 'oeste'],
    'peruibe': ['Peruíbe', null, null, 'baixada']
  };
  // Nomes digitados diferente que são a mesma cidade.
  var ALIAS = {
    'saopaulo': 'sao paulo', 'sao pauloq': 'sao paulo', 'sao paulo sp': 'sao paulo',
    'diadema sp': 'diadema', 'diadema jabaquara sao paulo abcd': 'diadema',
    'sao caetano': 'sao caetano do sul', 'sao bernardo': 'sao bernardo do campo',
    'alphaville': 'barueri'
  };
  var REGIOES = [
    ['capital', 'São Paulo (capital)'],
    ['abc', 'Grande ABC'],
    ['oeste', 'Osasco e região oeste'],
    ['baixada', 'Baixada Santista'],
    ['leste', 'Alto Tietê (Mogi, Suzano)'],
    ['norte', 'Guarulhos e norte']
  ];
  // Janela do mapa (graus) e tamanho do desenho.
  var LAT_N = -23.10, LAT_S = -24.25, LON_O = -47.35, LON_L = -45.85, W = 520, H = 436;

  function chave(s) {
    var k = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    return ALIAS[k] || k;
  }
  function bonito(s) {
    return String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/ (De|Do|Da|Dos|Das|E) /g, function (m) { return m.toLowerCase(); });
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // Junta variações do mesmo nome. Número só vale a partir de 3 profissionais (regra do contador).
  function norm(lista) {
    var mapa = {}, ordem = [];
    (Array.isArray(lista) ? lista : []).forEach(function (c) {
      var k = chave(c && c.cidade); if (!k) return;
      var uf = c.uf || '', n = Number(c.n); n = isFinite(n) && n > 0 ? n : 0;
      if (!mapa[k]) { mapa[k] = { key: k, cidade: CIDADES[k] ? CIDADES[k][0] : bonito(c.cidade), uf: uf, n: 0 }; ordem.push(k); }
      mapa[k].n += n;
      if (!mapa[k].uf && uf) mapa[k].uf = uf;
    });
    return ordem.map(function (k) { var r = mapa[k]; return { key: r.key, cidade: r.cidade, uf: r.uf, n: r.n >= 3 ? r.n : null }; })
      .sort(function (a, b) { return (b.n || 0) - (a.n || 0); });
  }
  g.QFCidadesNorm = norm;

  function proj(lat, lon) { return [(lon - LON_O) / (LON_L - LON_O) * W, (LAT_N - lat) / (LAT_N - LAT_S) * H]; }
  function dentro(lat, lon) { return lat <= LAT_N && lat >= LAT_S && lon >= LON_O && lon <= LON_L; }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }

  var OCEANO = [[-24.25, -46.90], [-24.19, -46.80], [-24.10, -46.62], [-24.03, -46.42], [-23.99, -46.30], [-23.93, -46.20], [-23.85, -46.14], [-23.82, -46.00], [-23.78, -45.85]];

  var alturaMapa = H; // altura do desenho (unidades do viewBox); cresce para igualar a coluna da direita
  function mapaSvg(lista, h) {
    h = Math.max(H, Math.min(H + 300, Number(h) || H));
    // costa: segue a linha original e, se o desenho ficou mais alto, continua para o sudoeste
    var pts = OCEANO.map(function (p) { var q = proj(p[0], p[1]); return [q[0], q[1]]; });
    var ini = pts[0], base = [];
    if (h > H) {
      var k = (pts[1][0] - pts[0][0]) / (pts[1][1] - pts[0][1]); // inclinação do primeiro trecho da costa (x por y; negativa)
      var xs = ini[0] + k * (h - ini[1]);
      if (xs < 0) { var ys = ini[1] + (0 - ini[0]) / k; pts.unshift([0, ys]); base = [[0, h]]; }
      else { pts.unshift([xs, h]); }
    }
    var costa = pts.map(function (q) { return f1(q[0]) + ',' + f1(q[1]); }).join(' L');
    var oceano = 'M' + costa + ' L' + W + ',' + h + (base.length ? ' L0,' + h : '') + ' Z';
    var grade = '';
    for (var gy = 87; gy < h; gy += 87) grade += 'M0 ' + gy + 'H' + W;
    for (var gx = 104; gx < W; gx += 104) grade += 'M' + gx + ' 0V' + h;
    var grandes = '', pequenos = '', sp = null;
    lista.forEach(function (c) {
      var d = CIDADES[c.key]; if (!d || d[1] == null || !dentro(d[1], d[2])) return;
      var p = proj(d[1], d[2]), tip = '<title>' + esc(d[0]) + (c.n ? ': ' + c.n + ' profissionais' : '') + '</title>';
      if (c.n) {
        var r = Math.min(34, 2.4 * Math.sqrt(c.n));
        grandes += '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="' + f1(r) + '"' + (c.key === 'sao paulo' ? ' fill-opacity="0.78"' : '') + '>' + tip + '</circle>';
        if (c.key === 'sao paulo') sp = { x: p[0], y: p[1], n: c.n };
      } else {
        pequenos += '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="3.2">' + tip + '</circle>';
      }
    });
    var txt = '<g class="qf-mapa__rotulos">' +
      (sp ? '<text x="' + f1(sp.x) + '" y="' + f1(sp.y - 2.6) + '" text-anchor="middle" class="qf-mapa__sp">São Paulo</text><text x="' + f1(sp.x) + '" y="' + f1(sp.y + 13.4) + '" text-anchor="middle" class="qf-mapa__sp qf-mapa__sp--n">' + sp.n + '</text>' : '') +
      '<text x="296" y="128">Guarulhos</text><text x="186" y="146" text-anchor="end">Osasco e região</text>' +
      '<text x="402" y="146" text-anchor="middle">Mogi das Cruzes</text><text x="172" y="30">Jundiaí</text>' +
      '<text x="498" y="34" text-anchor="end">São José dos Campos</text><text x="288" y="256" text-anchor="middle">Grande ABC</text>' +
      '<text x="300" y="396" text-anchor="middle">Baixada Santista</text></g>';
    var eY = h - 20;
    return '<svg viewBox="0 0 ' + W + ' ' + f1(h) + '" width="100%" role="img" aria-label="Mapa estilizado da Grande São Paulo e da Baixada Santista com a quantidade de profissionais por cidade">' +
      '<rect width="' + W + '" height="' + f1(h) + '" class="qf-mapa__terra"/>' +
      '<path class="qf-mapa__grade" d="' + grade + '"/>' +
      '<path class="qf-mapa__mar" d="' + oceano + '"/><path class="qf-mapa__costa" d="M' + costa + '"/>' +
      '<text x="440" y="372" text-anchor="middle" class="qf-mapa__oceano">Oceano Atlântico</text>' +
      '<g class="qf-mapa__poucos">' + pequenos + '</g><g class="qf-mapa__muitos">' + grandes + '</g>' + txt +
      '<path class="qf-mapa__escala" d="M18 ' + f1(eY) + 'H52M18 ' + f1(eY - 5) + 'V' + f1(eY + 5) + 'M52 ' + f1(eY - 5) + 'V' + f1(eY + 5) + '"/><text x="35" y="' + f1(eY - 10) + '" text-anchor="middle" class="qf-mapa__escala-t">10 km</text></svg>';
  }

  function cartaoHtml(d) {
    var total = Number(d && d.total) || 0, lista = norm(d && d.lista);
    if (total < 1 || !lista.length) return '';
    var porRegiao = {}, soma = 0;
    lista.forEach(function (c) { var r = CIDADES[c.key] && CIDADES[c.key][3]; if (r && c.n) { porRegiao[r] = (porRegiao[r] || 0) + c.n; soma += c.n; } });
    var maioria = soma / total >= 0.5;
    var fora = lista.filter(function (c) { var x = CIDADES[c.key]; return c.n && !(x && x[1] != null && dentro(x[1], x[2])); }).slice(0, 3).map(function (c) { return c.cidade; });
    var ufs = []; lista.forEach(function (c) { if (c.uf && c.uf !== 'SP' && ufs.indexOf(c.uf) < 0) ufs.push(c.uf); });
    var tiles = REGIOES.filter(function (r) { return porRegiao[r[0]]; }).sort(function (a, b) { return porRegiao[b[0]] - porRegiao[a[0]]; }).map(function (r) {
      return '<div class="qf-mapa__tile"><b>' + porRegiao[r[0]] + '</b><span>' + esc(r[1]) + '</span></div>';
    }).join('');
    var alem = '';
    if (fora.length || ufs.length) {
      alem = 'Também temos profissionais ' + (fora.length ? 'em ' + esc(fora.join(', ')) + (ufs.length ? ' e ' : '') : '') + (ufs.length ? 'em outros estados (' + esc(ufs.join(', ')) + ')' : '') + '. ';
    }
    return '<section class="qf-mapa" data-qf-mapa aria-labelledby="qf-mapa-t">' +
      '<div class="qf-mapa__head"><div class="qf-mapa__icone" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.6"/></svg></div>' +
      '<div><h2 id="qf-mapa-t">Onde o QuemFaz já atende</h2><p><strong>' + total + ' profissionais</strong> em ' + lista.length + ' cidades' + (maioria ? ', a maioria na Grande São Paulo e na Baixada Santista.' : '.') + '</p></div></div>' +
      '<div class="qf-mapa__mapa">' + mapaSvg(lista, alturaMapa) + '</div>' +
      '<div class="qf-mapa__legenda"><span><i class="qf-mapa__bola"></i>círculo maior = mais profissionais</span><span><i class="qf-mapa__bola qf-mapa__bola--vazia"></i>1 ou 2 profissionais</span></div>' +
      (tiles ? '<div class="qf-mapa__tiles">' + tiles + '</div>' : '') +
      '<p class="qf-mapa__rodape">' + alem + '<strong>Não vê a sua cidade? Publique o pedido mesmo assim.</strong></p></section>';
  }

  // ---- dados e montagem ----
  var dados = null, timer = null, tentativas = 0, agendado = false;
  function lerCache() { try { var s = JSON.parse(g.localStorage.getItem('qf_home_stats') || 'null'); if (s && s.total) dados = s; } catch (_) {} }
  function pintar() {
    document.querySelectorAll('[data-qf-mapa]').forEach(function (el) {
      var h = dados ? cartaoHtml(dados) : '';
      if (!h) { el.remove(); return; }
      var t = document.createElement('div'); t.innerHTML = h; el.replaceWith(t.firstChild);
    });
    agendarAjuste();
  }
  function buscar() {
    var c = g.QFCloud && g.QFCloud.client;
    if (!c) { if (tentativas++ < 12) setTimeout(buscar, 1500); return; }
    Promise.resolve(c.rpc('qf_home_stats')).then(function (r) {
      if (!r || r.error || !r.data || !r.data.total) return;
      dados = r.data; try { g.localStorage.setItem('qf_home_stats', JSON.stringify(r.data)); } catch (_) {}
      pintar(); montar();
    }).catch(function () {});
  }
  // Distribui os cartões nas duas colunas, sem deixar o lado do mapa vazio.
  function subirComo() {
    var serv = document.querySelector('#qf-sec-servicos'), como = document.querySelector('#qf-sec-como');
    var visual = document.querySelector('.qf-home-visual'), actions = document.querySelector('.qf-landing-actions');
    if (!serv || !como || !visual || !actions) return;
    if (serv.parentNode !== visual) visual.appendChild(serv);
    como.classList.add('qf-como-direita');
    if (como.parentNode !== actions) actions.appendChild(como);
  }
  // O mapa ocupa uma faixa própria; a altura não estica a coluna da esquerda.
  function agendarAjuste() {}

  function montar() {
    agendado = false;
    if (!g.matchMedia || !g.matchMedia('(min-width:900px)').matches) return;
    subirComo();
    var visual = document.querySelector('.qf-home-visual');
    if (!visual || !visual.parentNode || document.querySelector('[data-qf-mapa]')) return;
    if (!dados) lerCache();
    var h = dados ? cartaoHtml(dados) : '';
    if (h) { var t = document.createElement('div'); t.innerHTML = h; visual.parentNode.appendChild(t.firstChild); agendarAjuste(); }
    if (!timer) {
      buscar();
      timer = setInterval(function () { if (!document.querySelector('[data-qf-mapa]')) { clearInterval(timer); timer = null; return; } if (!document.hidden) { tentativas = 0; buscar(); } }, 60000);
    }
  }
  function agendar() { if (agendado) return; agendado = true; (g.requestAnimationFrame || setTimeout)(montar); }
  function iniciar() {
    new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true });
    agendar();
    if (g.matchMedia) { try { g.matchMedia('(min-width:900px)').addEventListener('change', agendar); } catch (_) {} }
  }
  if (document.body) iniciar(); else document.addEventListener('DOMContentLoaded', iniciar);
  g.QFMapaRegioes = { norm: norm, html: cartaoHtml };
})(window);
