'use strict';

// Páginas existentes com sinais de demanda ou lacunas de conteúdo. O catálogo
// continua responsável pela cobertura, pelo formulário e pela seleção do sitemap.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const out = path.join(__dirname, '..', 'dist');
const origin = 'https://quemfazservico.com.br';
const route = slug => '/servicos/' + slug + '/';
const fileFor = pathname => path.join(out, pathname, 'index.html');
const escape = value => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const sitemap = new Set([...fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]));
const entries = [
  ['diarista/santo-andre', 'Diarista em Santo André', 'faxina residencial',
    'Precisa de faxina em Santo André? Informe os ambientes, o bairro e a data desejada. Publique seu pedido grátis e compare as propostas que receber.',
    'Faxina regular em casa ou apartamento',
    'Se você precisa de uma diária recorrente, indique a frequência e os ambientes prioritários. Para uma primeira faxina, descreva o estado do imóvel e se espera limpeza interna de armários ou apenas superfícies. Em prédios, indique se a portaria exige cadastro prévio.',
    ['diarista/guarulhos', 'limpeza-de-sofa/santo-andre']],
  ['pedreiro/guarulhos', 'Pedreiro em Guarulhos', 'obras e pequenos reparos',
    'Peça orçamento de pedreiro em Guarulhos para alvenaria, reboco ou pequenos reparos. Informe medidas e bairro e publique seu pedido grátis.',
    'Como pedir orçamento de alvenaria ou reparo',
    'Descreva se é uma parede nova, reboco solto ou acabamento de uma reforma. Indique a metragem aproximada, o bairro em Guarulhos, o acesso para materiais e quem ficará com a retirada do entulho. Peça que a proposta separe material e mão de obra.',
    ['eletricista/guarulhos', 'encanador']],
  ['eletricista/santo-andre', 'Eletricista em Santo André', 'instalações e reparos',
    'Procura eletricista em Santo André? Descreva o serviço de tomadas, iluminação ou disjuntores, confirme o CEP e publique seu pedido grátis.',
    'Tomadas, iluminação e revisão do quadro',
    'Para uma instalação, diga quantos pontos precisam ser criados ou ajustados. Para um reparo, explique se o defeito é contínuo ou aparece ao ligar um aparelho. Informe o bairro de Santo André e, em condomínio, se existe horário permitido para o serviço.',
    ['eletricista/diadema', 'eletricista/abc', 'montador-de-moveis/santo-andre']],
  ['diarista/guarulhos', 'Diarista em Guarulhos', 'faxina de rotina ou pesada',
    'Procura diarista em Guarulhos? Descreva os cômodos, o tipo de faxina e os materiais disponíveis. Publique seu pedido grátis pelo Quem Faz.',
    'Como combinar a faxina para mudança',
    'Diga se o imóvel em Guarulhos estará vazio ou mobiliado, quando será a entrega das chaves e quais áreas precisam de limpeza, como cozinha e banheiros. Combine se a diária inclui janelas acessíveis, área de serviço ou limpeza de armários vazios.',
    ['diarista/santo-andre', 'montador-de-moveis/guarulhos']],
  ['marido-de-aluguel/abc', 'Marido de aluguel no ABC Paulista', 'instalações e pequenos reparos',
    'Precisa instalar cortinas, ajustar portas ou montar prateleiras no ABC Paulista? Confirme a cidade pelo CEP e publique seu pedido grátis.',
    'Agrupe pequenos reparos no mesmo pedido',
    'Faça uma lista dos itens, como varão de cortina, prateleira ou dobradiça. Diga quais peças você já tem e se as superfícies são de alvenaria, madeira ou drywall. Como o ABC reúne vários municípios, confirme o CEP do endereço de atendimento.',
    ['marido-de-aluguel/santo-andre', 'montador-de-moveis/abc', 'eletricista/abc']],
  ['eletricista', 'Eletricista perto de você', 'orçamento de reparos e instalações',
    'Solicite orçamento de eletricista para tomadas, chuveiros, iluminação ou disjuntores. Confira sua região pelo CEP e publique seu pedido grátis.',
    'Instalação nova ou diagnóstico de falha?',
    'Para instalar um equipamento, informe o modelo e se o imóvel já tem um ponto preparado. Para uma falha recorrente, diga o que acontece, desde quando e quais ambientes são afetados. Pergunte se a proposta inclui diagnóstico, mão de obra e materiais.',
    ['eletricista/santo-andre', 'eletricista/guarulhos', 'eletricista/abc']],
  ['encanador', 'Encanador perto de você', 'vazamentos e reparos hidráulicos',
    'Precisa de encanador para vazamento, descarga ou troca de torneira? Descreva o problema, confirme o CEP e publique seu pedido grátis.',
    'O vazamento é aparente ou precisa de diagnóstico?',
    'Informe se o vazamento aparece na torneira, abaixo da pia ou como umidade atrás do revestimento. Diga se o registro atende apenas seu imóvel ou é compartilhado. Combine o custo da visita e o escopo do reparo antes de autorizar o serviço.',
    ['encanador/santo-andre', 'encanador/sao-bernardo-do-campo', 'encanador/abc']],
  ['eletricista/abc', 'Eletricista no ABC Paulista', 'reparos e instalações elétricas',
    'Peça orçamento de eletricista no ABC Paulista para tomadas, iluminação ou disjuntores. Confirme o município pelo CEP e publique grátis.',
    'Escolha onde será o atendimento',
    'Informe o CEP do imóvel, inclusive se você mora em outra cidade do ABC. Descreva se é uma instalação residencial, um reparo no comércio ou uma avaliação em condomínio, pois o acesso e o horário podem alterar a proposta.',
    ['eletricista/santo-andre', 'eletricista/diadema', 'encanador/abc']],
  ['encanador/abc', 'Encanador no ABC Paulista', 'orçamento de serviços hidráulicos',
    'Peça orçamento de encanador no ABC Paulista para vazamento, descarga ou torneira. Informe o CEP real do serviço e publique grátis.',
    'Reparo em imóvel residencial ou condomínio',
    'Indique se o problema está dentro da unidade ou em uma área comum. Se for compartilhado, explique quem autoriza a visita. Confirme o município pelo CEP para que o pedido seja encaminhado de acordo com o endereço.',
    ['encanador/santo-andre', 'encanador/sao-bernardo-do-campo', 'eletricista/abc']],
  ['diarista/abc', 'Diarista no ABC Paulista', 'faxina residencial',
    'Procura diarista no ABC Paulista? Detalhe a faxina, confirme o município pelo CEP e publique seu pedido grátis para receber propostas.',
    'Compare propostas para as mesmas tarefas',
    'Use o CEP do imóvel que será limpo, principalmente quando estiver organizando mudança entre cidades do ABC. Informe se o imóvel está ocupado e liste tarefas extras separadamente para comparar propostas com o mesmo escopo.',
    ['diarista/santo-andre', 'diarista/sao-bernardo-do-campo']],
  ['montador-de-moveis', 'Montador de móveis perto de você', 'montagem e desmontagem',
    'Precisa montar um guarda-roupa, painel ou cômoda? Informe modelo e quantidade, consulte sua região pelo CEP e publique seu pedido grátis.',
    'Montagem de móvel novo ou remontagem?',
    'Informe se o móvel está lacrado ou se já foi desmontado. Em caso de remontagem, diga se as ferragens foram guardadas e se é preciso ajustar portas ou gavetas. Combine se o preço inclui fixação, desmontagem e deslocamento.',
    ['montador-de-moveis/abc', 'montador-de-moveis/guarulhos', 'montador-de-moveis/sao-paulo']],
  ['montador-de-moveis/abc', 'Montador de móveis no ABC Paulista', 'montagem para casa ou mudança',
    'Publique seu pedido grátis de montagem, desmontagem ou remontagem de móveis no ABC Paulista. Confirme o município de atendimento pelo CEP.',
    'Desmontagem e remontagem em endereços diferentes',
    'Se for uma mudança dentro da região, descreva os dois locais e se o transporte já foi contratado. Informe o CEP principal no formulário. Combine se a proposta cobre uma visita ou as duas etapas e se há necessidade de etiquetar as peças.',
    ['montador-de-moveis/santo-andre', 'montador-de-moveis/sao-bernardo-do-campo']],
  ['montador-de-moveis/santo-andre', 'Montador de móveis em Santo André', 'guarda-roupas, cômodas e painéis',
    'Peça orçamento de montagem de móveis em Santo André. Informe o modelo, as peças e se precisa de fixação. Publique seu pedido grátis.',
    'Montagem de guarda-roupa em apartamento',
    'Informe se as caixas já estão no cômodo e se há espaço para montar o guarda-roupa deitado. Diga se há portas de correr ou espelhos e se o condomínio em Santo André exige agendamento. Combine a fixação antes de fechar.',
    ['montador-de-moveis/abc', 'marido-de-aluguel/santo-andre']],
  ['montador-de-moveis/guarulhos', 'Montador de móveis em Guarulhos', 'montagem e remontagem',
    'Precisa de montagem de guarda-roupa, cômoda ou painel em Guarulhos? Informe bairro, modelo e data e publique seu pedido grátis.',
    'Monte o pedido com base nas caixas e no manual',
    'Se a entrega em Guarulhos foi dividida em volumes, confira se todos chegaram antes de marcar a montagem. Informe quantos móveis são, se já há manual e ferragens e se há um painel ou armário aéreo que precisa de fixação.',
    ['montador-de-moveis', 'diarista/guarulhos']],
  ['montador-de-moveis/sao-bernardo-do-campo', 'Montador de móveis em São Bernardo do Campo', 'montagem residencial',
    'Solicite montagem de guarda-roupa, estante ou escrivaninha em São Bernardo do Campo. Informe o modelo e publique seu pedido grátis.',
    'Montagem de mais de um móvel no mesmo endereço',
    'Liste cada móvel e indique quais já estão no cômodo. Se precisar montar uma estação de trabalho ou estante, diga se há passa-cabos, suportes ou adaptação prevista. Combine se o orçamento é por peça ou pelo conjunto.',
    ['montador-de-moveis/abc', 'montador-de-moveis/santo-andre']],
  ['montador-de-moveis/sao-paulo', 'Montador de móveis em São Paulo', 'montagem residencial',
    'Peça montagem de móveis em São Paulo para armários, camas e escrivaninhas. Informe o CEP, o modelo e o prazo. Publique grátis.',
    'Informe acesso e horário antes de agendar',
    'Indique o bairro, o andar, a disponibilidade de elevador e os horários permitidos pelo prédio. Esclareça se o serviço é apenas montagem ou inclui desmontar a peça antiga e ajustar o móvel ao espaço disponível.',
    ['montador-de-moveis', 'montador-de-moveis/guarulhos']],
  ['eletricista/diadema', 'Eletricista em Diadema', 'reparos e diagnóstico',
    'Disjuntor desarmando ou tomada com defeito em Diadema? Explique quando a falha acontece e publique seu pedido grátis.',
    'Falha intermitente precisa de detalhes',
    'Diga se a falha aparece sempre no mesmo horário ou ao usar um aparelho específico. Se o defeito afeta uma loja ou pequeno comércio em Diadema, informe horários de acesso e se a interrupção do circuito exige agendamento.',
    ['eletricista/santo-andre', 'eletricista/abc']],
  ['eletricista/guarulhos', 'Eletricista em Guarulhos', 'instalação elétrica e reparos',
    'Solicite eletricista em Guarulhos para tomadas, chuveiro ou iluminação. Confirme o CEP do imóvel e publique seu pedido grátis.',
    'Instalar ou substituir um equipamento',
    'Informe se já existe um ponto instalado e se o aparelho será substituído ou colocado em outro local. Se souber, mencione modelo e potência. Combine se o orçamento inclui avaliação, ligação, materiais e testes.',
    ['eletricista', 'pedreiro/guarulhos', 'gasista/guarulhos']],
  ['gasista', 'Gasista perto de você', 'instalação de fogão e aquecedor',
    'Solicite técnico gasista para avaliar a instalação de fogão, aquecedor ou ponto de gás. Consulte o atendimento pelo CEP e publique grátis.',
    'Qual equipamento o técnico precisa avaliar?',
    'Informe o modelo do fogão ou aquecedor, o tipo de gás disponível e se é uma primeira instalação ou substituição. Antes de contratar, confirme quem fornece os componentes, quais testes estão incluídos e se haverá documentação.',
    ['gasista/guarulhos', 'gasista/sao-paulo']],
  ['gasista/guarulhos', 'Gasista em Guarulhos', 'instalações de fogão e aquecedor',
    'Solicite gasista em Guarulhos para avaliação de fogão, aquecedor ou ponto de gás. Informe o CEP e publique seu pedido grátis.',
    'Instalação em condomínio ou residência',
    'Informe o modelo do aparelho e se o imóvel usa gás encanado ou botijão. Em condomínio, confirme com a administração quais documentos e horários são exigidos. Peça que a proposta detalhe visita, componentes e testes.',
    ['gasista', 'eletricista/guarulhos']],
  ['gasista/sao-paulo', 'Gasista em São Paulo', 'avaliação de instalações de gás',
    'Precisa de gasista em São Paulo para fogão, aquecedor ou avaliação da instalação? Informe o bairro e publique seu pedido grátis.',
    'Avaliação antes de trocar um aquecedor',
    'Informe se o aparelho será trocado no mesmo ponto, se já tem o manual e como é o acesso à área de instalação. Confirme com o técnico a compatibilidade e, se for em condomínio, as exigências de cadastro ou documentação.',
    ['gasista', 'gasista/guarulhos']],
  ['limpeza-de-sofa', 'Limpeza de sofá', 'orçamento de higienização',
    'Peça limpeza de sofá pelo Quem Faz. Informe tecido, número de lugares e manchas, consulte seu CEP e publique seu pedido grátis.',
    'Compare propostas pelo mesmo sofá',
    'Informe se o preço é para a peça toda ou por lugar. Descreva almofadas removíveis, tipo de tecido e manchas antigas. Pergunte sobre secagem, necessidade de ventilação e quais itens entram no orçamento.',
    ['limpeza-de-sofa/abc', 'limpeza-de-sofa/sao-paulo', 'limpeza-de-estofados-e-tapetes']],
  ['limpeza-de-sofa/abc', 'Limpeza de sofá no ABC Paulista', 'orçamento por cidade',
    'Publique seu pedido grátis de limpeza de sofá no ABC Paulista. Indique o tipo de estofado e confirme a cidade de atendimento pelo CEP.',
    'Escolha o município pelo CEP do estofado',
    'O endereço de atendimento pode ser diferente de onde você mora. Informe se o sofá fica em apartamento, casa ou comércio e se há regras de acesso. Compare prazo de secagem, técnica e custo total com deslocamento.',
    ['limpeza-de-sofa/santo-andre', 'limpeza-de-sofa/sao-bernardo-do-campo', 'limpeza-de-sofa/diadema']],
  ['limpeza-de-sofa/santo-andre', 'Limpeza de sofá em Santo André', 'higienização de estofados',
    'Peça limpeza de sofá em Santo André. Descreva o tecido, as manchas e os lugares do sofá. Informe o CEP e publique seu pedido grátis.',
    'Higienização quando há animais no imóvel',
    'Informe se o objetivo é remover pelos, tratar odor ou limpar manchas, pois as propostas podem incluir tarefas diferentes. Se houver animais no imóvel, combine quando voltarão a usar o ambiente e quando o sofá poderá ser utilizado.',
    ['limpeza-de-sofa/abc', 'diarista/santo-andre']],
  ['limpeza-de-sofa/sao-bernardo-do-campo', 'Limpeza de sofá em São Bernardo do Campo', 'sofás retráteis e estofados',
    'Solicite limpeza de sofá em São Bernardo do Campo. Informe o tamanho, o tecido e se o sofá é retrátil. Publique seu pedido grátis.',
    'Sofá retrátil com peças móveis',
    'Conte se há braços largos, extensão retrátil ou peças removíveis. Confirme se o orçamento inclui a parte interna da extensão e o encosto. Pergunte como organizar a ventilação antes de combinar o horário.',
    ['limpeza-de-sofa/abc', 'limpeza-de-sofa/santo-andre']],
  ['limpeza-de-sofa/maua', 'Limpeza de sofá em Mauá', 'higienização residencial',
    'Precisa higienizar um sofá em Mauá? Informe o tecido, o número de lugares e o bairro. Publique seu pedido grátis pelo Quem Faz.',
    'Higienização para preparar o imóvel',
    'Se a limpeza faz parte de uma mudança, informe se o sofá já estará no destino e se a energia e a água estarão disponíveis no dia. Descreva manchas existentes e combine quando a peça poderá ser usada depois do atendimento.',
    ['limpeza-de-sofa/abc', 'limpeza-de-sofa/santo-andre']],
  ['limpeza-de-sofa/diadema', 'Limpeza de sofá em Diadema', 'orçamento de higienização',
    'Solicite limpeza de sofá em Diadema para estofado fixo ou retrátil. Informe as condições da peça e publique seu pedido grátis.',
    'Sofá com tecido delicado ou sem etiqueta',
    'Informe se ainda há etiqueta de conservação e se houve aplicação de algum produto antes da visita. Se o tecido for desconhecido, peça que o profissional avalie a compatibilidade do método antes de combinar o valor.',
    ['limpeza-de-sofa/abc', 'limpeza-de-sofa/sao-bernardo-do-campo']],
  ['limpeza-de-sofa/sao-paulo', 'Limpeza de sofá em São Paulo', 'higienização em casa ou apartamento',
    'Peça limpeza de sofá em São Paulo. Descreva o estofado, informe o CEP do serviço e publique seu pedido grátis pelo Quem Faz.',
    'Higienização em apartamento ocupado',
    'Indique se há ventilação natural, horários de acesso e espaço para os equipamentos. Se a peça for usada diariamente, confirme a previsão de secagem e como proteger o ambiente durante o serviço.',
    ['limpeza-de-sofa', 'limpeza-de-estofados-e-tapetes']],
  ['limpeza-de-estofados-e-tapetes', 'Limpeza de estofados e tapetes', 'poltronas, cadeiras e tapetes',
    'Solicite limpeza de poltronas, cadeiras e tapetes. Informe quantidade, material e dimensões. Consulte seu CEP e publique o pedido grátis.',
    'Peça valores por tipo de peça',
    'Separe no pedido a quantidade de poltronas, cadeiras e tapetes. Informe as medidas dos tapetes e pergunte se a lavagem é no local ou com retirada. Para um sofá específico, use o guia de limpeza de sofá.',
    ['limpeza-de-sofa', 'limpeza-de-sofa/abc']]
];

const bySlug = new Map(entries.map(entry => [entry[0], entry]));
const relatedNames = {
  'marido-de-aluguel/santo-andre':'Marido de aluguel em Santo André',
  'encanador/santo-andre':'Encanador em Santo André',
  'encanador/sao-bernardo-do-campo':'Encanador em São Bernardo do Campo',
  'diarista/sao-bernardo-do-campo':'Diarista em São Bernardo do Campo'
};
const styleHash = createHash('sha256').update(fs.readFileSync(path.join(out, 'qf-seo-servicos.css'))).digest('hex').slice(0, 12);
const scriptHash = createHash('sha256').update(fs.readFileSync(path.join(out, 'qf-seo-servicos.js'))).digest('hex').slice(0, 12);
const primaryCta = '<a class="seo-cta" href="#pedido">Publicar pedido grátis <span aria-hidden="true">→</span></a>';

function replace(html, pattern, value, url) {
  if (!pattern.test(html)) throw new Error('SEO etapa 2: estrutura ausente em ' + url + ' (' + pattern + ')');
  return html.replace(pattern, value);
}
function relatedLinks(slugs) {
  return '<ul class="seo-links">' + slugs.map(slug => {
    const pathname = route(slug);
    if (!sitemap.has(origin + pathname)) throw new Error('Link SEO fora do sitemap: ' + pathname);
    return '<li><a href="' + pathname + '">' + escape(bySlug.get(slug)?.[1] ?? relatedNames[slug]) + '</a></li>';
  }).join('') + '</ul>';
}

for (const [slug, name, intent, description, question, answer, related] of entries) {
  const pathname = route(slug);
  const url = origin + pathname;
  if (!sitemap.has(url)) throw new Error('Página SEO sem índice aprovado: ' + url);
  const file = fileFor(pathname);
  let html = fs.readFileSync(file, 'utf8');
  const title = name + ': ' + intent + ' | Quem Faz';
  const config = JSON.parse(html.match(/<script id="seo-config" type="application\/json">([^<]+)<\/script>/)[1]);
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1]);
  const webpage = graph['@graph'].find(node => node['@type'] === 'WebPage');
  const breadcrumbs = graph['@graph'].find(node => node['@type'] === 'BreadcrumbList');
  const serviceId = url + '#servico';
  const area = config.city && config.uf
    ? {'@type':'City', name:config.city, containedInPlace:{'@type':'State',name:config.uf}}
    : slug.endsWith('/abc') ? {'@type':'Place',name:'ABC Paulista'} : null;
  Object.assign(webpage, {name,description,mainEntity:{'@id':serviceId}});
  const trail = breadcrumbs.itemListElement;
  if (trail.at(-1).item !== url) trail.push({'@type':'ListItem',position:trail.length + 1,name,item:url});
  else trail.at(-1).name = name;
  graph['@graph'].push({
    '@type':'Service', '@id':serviceId, name, description, url,
    serviceType:config.service, ...(area && {areaServed:area}),
    broker:{'@type':'Organization',name:'Quem Faz Serviços',url:origin}
  });

  html = replace(html, /<title>[^<]+<\/title>/, '<title>' + escape(title) + '</title>', url);
  for (const [attr, key, value] of [['name','description',description],['property','og:title',title],['property','og:description',description]]) {
    html = replace(html, new RegExp('(<meta '+attr+'="'+key+'" content=")[^"]*(">)'), (_, start, end) => start + escape(value) + end, url);
  }
  html = replace(html, /<h1>[^<]+<\/h1>/, '<h1>' + escape(name) + '</h1>', url);
  html = replace(html, /<body class="seo-page">/, '<body class="seo-page seo-stage2">', url);
  html = replace(html, /<nav aria-label="Caminho">[\s\S]*?<\/nav>/, '<nav aria-label="Caminho"><a href="/">Início</a> / ' +
    trail.slice(0, -1).map(crumb => '<a href="' + new URL(crumb.item).pathname + '">' + escape(crumb.name) + '</a>').join(' / ') +
    ' / <span aria-current="page">' + escape(name) + '</span></nav>', url);
  html = replace(html, /<p class="seo-lead">[^<]+<\/p>/, '<p class="seo-lead">' + escape(description) + '</p>', url);
  html = replace(html, /<a class="seo-cta" href="#pedido">[\s\S]*?<\/a>/, primaryCta, url);
  html = replace(html, /<h2>Solicite seu orçamento grátis<\/h2>/, '<h2>Publique seu pedido grátis</h2>', url);
  html = replace(html, /<script type="application\/ld\+json">[^<]+<\/script>/, '<script type="application/ld+json">' + json(graph) + '</script>', url);
  // Uma única representação schema.org do serviço por URL.
  html = html.replace(/<script type="application\/ld\+json" data-qf-ai-schema>[^<]+<\/script>/, '');
  html = replace(html, /<article class="seo-content">/, '<article class="seo-content"><section data-qf-seo-etapa="2"><h2>' +
    escape(question) + '</h2><p>' + escape(answer) + '</p><p><a href="#pedido">Publicar pedido grátis</a></p>'+
    '<h3>Serviços e regiões relacionados</h3>' + relatedLinks(related) + '</section>', url);
  // A folha do conteúdo SEO continua crítica. A folha grande do app só precisa estar
  // aplicada quando o formulário monta; baixá-la em paralelo libera a primeira pintura.
  html = replace(html, /<link rel="stylesheet" href="(\/app-style-[^"]+\.css)">/,
    (_, css) => '<link rel="preload" as="style" href="' + css + '" onload="this.onload=null;this.rel=\'stylesheet\'"><noscript><link rel="stylesheet" href="' + css + '"></noscript>', url);
  html = replace(html, /href="\/qf-seo-servicos\.css"/, 'href="/qf-seo-servicos.css?v=' + styleHash + '"', url);
  html = replace(html, /src="\/qf-seo-servicos\.js"/, 'src="/qf-seo-servicos.js?v=' + scriptHash + '"', url);
  fs.writeFileSync(file, html);
}

// Pontos de entrada para as prioridades do Search Console, com links no HTML.
const discovery = {
  '/servicos/': ['diarista/santo-andre','pedreiro/guarulhos','eletricista/santo-andre','diarista/guarulhos','marido-de-aluguel/abc','gasista'],
  '/servicos/cidades/santo-andre/': ['diarista/santo-andre','eletricista/santo-andre','montador-de-moveis/santo-andre','limpeza-de-sofa/santo-andre'],
  '/servicos/cidades/guarulhos/': ['diarista/guarulhos','pedreiro/guarulhos','montador-de-moveis/guarulhos','gasista/guarulhos'],
  '/servicos/cidades/sao-paulo/': ['montador-de-moveis/sao-paulo','limpeza-de-sofa/sao-paulo','gasista/sao-paulo']
};
for (const [pathname, slugs] of Object.entries(discovery)) {
  const file = fileFor(pathname);
  const html = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, replace(html, /<article class="seo-content">/, '<article class="seo-content"><section data-qf-seo-etapa="2"><h2>Serviços em destaque</h2>' +
    relatedLinks(slugs) + '</section>', pathname));
}

console.log('SEO etapa 2: ' + entries.length + ' páginas de contratação e ' + Object.keys(discovery).length + ' catálogos vinculados.');
