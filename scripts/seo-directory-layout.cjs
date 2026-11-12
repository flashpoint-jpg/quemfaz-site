const icons = {
  bolt: 'M13 2 3 14h8l-1 8 11-13h-8z',
  tap: 'M3 15H1v-4h5l3-3h6l3 3h4v7h-5v-3h-4M12 8V4m-4 0h8m3 16c-2 2-1 3 0 3s2-1 0-3Z',
  broom: 'm13 11 6-9 2 1-6 10m-2-2 4 3-5 8-9-5 6-7zM7 15l8 5M4 4v5M2 7h5',
  paint: 'M18 5h3v7h-9v4M3 2h14v6H3zM10 16h4v6h-4z',
  cabinet: 'M3 2h18v19H3zM12 2v19M8 10v3m8-3v3M5 21v2m14-2v2',
  sofa: 'M4 11V8a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v3M4 11a3 3 0 0 0-2 5v3h20v-3a3 3 0 1 0-5-2v1H7v-1a3 3 0 0 0-3-3Zm1 8v2m14-2v2',
  tools: 'm4 3 4 4m4 4 9 9-2 2-9-9m8-9a4 4 0 0 0-5 5L3 19l2 2L15 11a4 4 0 0 0 5-5l-3 2-2-2z',
  clean: 'M10 2c0 5-3 8-8 8 5 0 8 3 8 8 0-5 3-8 8-8-5 0-8-3-8-8Zm9 12v7m-3-3h6',
  tech: 'M3 4h18v13H3zM8 21h8m-4-4v4M8 10l2 2 5-5',
  truck: 'M2 5h13v13H2zm13 5h4l3 4v4h-7M6 18a2 2 0 1 0 4 0m7 0a2 2 0 1 0 4 0',
  search: 'M16 16l5 5M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
  pin: 'M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  next: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
  check: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-13 0 3 3 5-6'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + icons[name] + '"/></svg>';
const featured = [
  ['eletricista', 'bolt', '', 'Instalações, reparos e manutenção elétrica.'],
  ['encanador', 'tap', '', 'Vazamentos, entupimentos e instalações.'],
  ['diarista', 'broom', '', 'Limpeza residencial e organização da casa.'],
  ['pintor', 'paint', '', 'Pintura interna e externa, de paredes a fachadas.'],
  ['montador-de-moveis', 'cabinet', '', 'Montagem e desmontagem de móveis.'],
  ['limpeza-de-estofados-e-tapetes', 'sofa', 'Limpeza de estofados', 'Higienização de sofás, tapetes e colchões.']
];
const abcCities = ['santo-andre', 'sao-bernardo-do-campo', 'maua', 'diadema', 'ribeirao-pires', 'rio-grande-da-serra'];
const trust = ['Grátis para publicar', 'Até 4 contatos', 'Você escolhe'];
const categories = [
  ['reformas', 'Reformas e manutenção', 'tools', /eletricista|encanador|montador|pedreiro|jardineiro|chaveiro|pintor|soldador|desentupidor|vidraceiro|serralheiro|marceneiro|marido-de-aluguel|gesseiro|azulejista|telhadista|calheiro|impermeabilizacao|piscineiro|paisagista/],
  ['limpeza', 'Limpeza e cuidados', 'clean', /diarista|limpeza|dedetizador|faxina|cuidador|passadeira|cozinheira|baba|banho-e-tosa|pet-sitter|adestrador|cabeleireiro|manicure|maquiador/],
  ['instalacao', 'Instalação e assistência', 'tech', /./],
  ['transporte', 'Transporte e fretes', 'truck', /mecanico|autoeletrico|automotiv|guincho|borracheiro|motorista|entregador|frete|mudancas|lava-jato/]
];

module.exports = function layout(html, services, cities, urlFor, esc) {
  const card = (href, label, glyph, extra = '', desc = '') => '<a class="directory-card" href="' + href + '"' + extra + '><span class="directory-icon">' + icon(glyph) + '</span><span class="directory-card-text"><b>' + esc(label) + '</b>' + (desc ? '<small>' + esc(desc) + '</small>' : '') + '</span>' + icon('next') + '</a>';
  const chip = (href, label, glyph, extra = '') => '<a class="directory-chip" href="' + href + '"' + extra + '>' + icon(glyph) + esc(label) + '</a>';
  const serviceLinks = services.map(s => {
    const [category] = [categories[0], categories[1], categories[3], categories[2]].find(entry => entry[3].test(s.slug));
    const [, , glyph] = categories.find(entry => entry[0] === category);
    const aliases = s.id === 'cat_limpeza_estofados' ? ' sofá higienização' : s.id === 'cat_diarista' ? ' faxina faxineira' : '';
    return card(urlFor(s), s.nome, glyph, ' data-service="' + esc(s.nome + aliases) + '" data-category="' + category + '"');
  }).join('');
  const highlights = featured.map(([slug, glyph, label, desc]) => {
    const service = services.find(s => s.slug === slug);
    return service ? card(urlFor(service), label || service.nome, glyph, '', desc) : '';
  }).join('');
  const cityChips = abcCities.map(slug => cities.find(c => c.slug === slug)).filter(Boolean)
    .map(c => chip('/servicos/cidades/' + c.slug + '/', c.nome, 'pin')).join('');
  const options = cities.map(c => '<option value="/servicos/cidades/' + c.slug + '/">' + esc(c.nome + ' / ' + c.uf) + '</option>').join('');
  const back = '<a class="directory-back" href="/">' + icon('back') + 'Voltar ao início</a>';
  const sections = `<div class="directory-toolbar">${back}</div>
  <section class="directory-hero">
    <div class="directory-hero-copy">
      <p class="seo-eyebrow">QUEM FAZ • SERVIÇOS NA SUA REGIÃO</p>
      <h1>Encontre serviços <span>na sua região</span></h1>
      <p>Escolha o serviço e publique seu pedido grátis.</p>
      <form class="directory-search" role="search" action="#catalogo">
        <label>${icon('search')}<input type="search" name="busca" aria-label="Qual serviço você precisa?" placeholder="Qual serviço você precisa?"></label>
        <button type="submit">Buscar serviços</button>
      </form>
      <a class="directory-hero-link" href="/?pedido=1#/auth/cliente/cadastro">Não achou? Publique seu pedido grátis ${icon('next')}</a>
      <ul class="directory-trust">${trust.map(t => '<li>' + icon('check') + esc(t) + '</li>').join('')}</ul>
    </div>
  </section>
  <section class="directory-section"><div class="directory-head"><h2>Serviços em destaque</h2><a href="#catalogo">Ver todos os serviços →</a></div><div class="directory-grid">${highlights}</div></section>
  <section class="directory-section"><h2>Explore por categoria</h2><div class="directory-chips">
    ${categories.map(([id, label, glyph]) => chip('#catalogo', label, glyph, ' data-filter="' + id + '"')).join('')}
  </div></section>
  <section class="directory-city"><div><h2>Encontre profissionais na sua cidade</h2><p>Escolha onde você está e veja os serviços atendidos.</p></div>
    <div class="directory-city-list">${cityChips}<label><select aria-label="Selecione a sua cidade"><option value="">Outra cidade</option>${options}</select></label></div>
    <noscript><a href="#guias">Ver cidades e guias</a></noscript>
  </section>
  <section class="directory-cta"><div><h2>Não encontrou o serviço? <span>Conte o que precisa.</span></h2><p>Publique seu pedido grátis e receba propostas de profissionais da sua região.</p></div><a href="/?pedido=1#/auth/cliente/cadastro">Publicar pedido grátis ${icon('next')}</a></section>
  <details class="directory-details" id="catalogo"><summary>Todos os serviços</summary>
    <p class="directory-results" role="status" hidden></p>
    <button class="directory-reset" type="button" hidden>Mostrar todos os serviços</button>
    <div class="directory-grid">${serviceLinks}</div>
  </details>
  <details class="directory-details" id="guias"><summary>Guias de serviços e cidades</summary>`;
  return html
    .replace('</head>', '<link rel="stylesheet" href="/qf-seo-directory.css"><script defer src="/qf-seo-directory.js"></script></head>')
    .replace('class="seo-page"', 'class="seo-page seo-directory"')
    .replace(/<div class="seo-hero">[\s\S]*?(?=<article class="seo-content">)/, sections)
    .replace('</article>', '</article></details>');
};
