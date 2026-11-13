// Conteúdo de apoio em URLs já validadas pelo gerador SEO.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const origin='https://quemfazservico.com.br';
const entries=[
  [
    "eletricista/santo-andre",
    "Quais detalhes ajudam a pedir eletricista em Santo André?",
    "Informe bairro, tipo de imóvel, pontos com defeito e urgência. Se houver risco elétrico, não tente abrir o quadro ou manusear fios.",
    "eletricista/diadema"
  ],
  [
    "eletricista/diadema",
    "Como descrever uma falha elétrica em Diadema?",
    "Diga se a falha ocorre em uma tomada, cômodo ou imóvel inteiro, quando começou e se o disjuntor desarma. Evite reparos em circuitos energizados.",
    "eletricista/santo-andre"
  ],
  [
    "encanador/sao-bernardo-do-campo",
    "O que colocar no pedido de encanador em São Bernardo?",
    "Conte se há vazamento em torneira, parede ou descarga, desde quando ocorre e se é possível fechar o registro com segurança.",
    "eletricista/santo-andre"
  ],
  [
    "diarista/santo-andre",
    "Como solicitar uma diarista em Santo André?",
    "Informe quantidade de cômodos, número de banheiros, tipo de faxina, data preferida e quais materiais estarão disponíveis.",
    "limpeza-de-sofa/sao-bernardo-do-campo"
  ],
  [
    "pintor/maua",
    "O que informar para contratar um pintor em Mauá?",
    "Descreva área aproximada, ambientes, estado das paredes, necessidade de preparação e prazo desejado.",
    "encanador/sao-bernardo-do-campo"
  ],
  [
    "eletricista/guarulhos",
    "Como pedir instalação elétrica em Guarulhos?",
    "Especifique se o serviço envolve tomada, chuveiro, luminária ou quadro, além do bairro e do tipo de imóvel. Não mexa em partes energizadas.",
    "eletricista/diadema"
  ],
  [
    "montador-de-moveis/sao-bernardo-do-campo",
    "Quais informações enviar para montar um móvel?",
    "Indique marca, modelo, número de móveis e se há manual, ferragens e espaço livre para montagem.",
    "encanador/sao-bernardo-do-campo"
  ],
  [
    "pintor/guarulhos",
    "Como comparar orçamento de pintura em Guarulhos?",
    "Confirme metragem, preparação da superfície, fornecimento de tinta, número de demãos, prazo e limpeza final.",
    "pintor/maua"
  ],
  [
    "diarista/guarulhos",
    "Como combinar uma faxina em Guarulhos?",
    "Informe bairro, tamanho do imóvel, tarefas desejadas, necessidade de janelas ou armários e data prevista.",
    "diarista/santo-andre"
  ],
  [
    "encanador/guarulhos",
    "Como solicitar reparo hidráulico em Guarulhos?",
    "Diga onde está o problema, se há água vazando agora, quando começou e se precisa de atendimento urgente.",
    "encanador/sao-bernardo-do-campo"
  ]
];
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localBudgets = [
  {
    slug: 'encanador/santo-andre',
    label: 'Encanador em Santo André',
    prices: 'A Cronoshare publica R$ 120 a R$ 220 para troca de torneira em Santo André, sem a peça, e R$ 200 a R$ 450 para reparo de vazamento simples.',
    sources: [['Cronoshare', 'https://www.cronoshare.com.br/servicos/encanadores/sao-paulo/santo-andre']],
    compare: 'Peça o valor da visita e confirme se ele será abatido do reparo. Se o problema estiver atrás da parede, peça que o profissional separe no orçamento o diagnóstico, o conserto, as peças e a recomposição do revestimento.',
    example: 'Exemplo de pedido: “Apartamento no Campestre. Aparece umidade no armário embaixo da pia quando uso a torneira. Preciso identificar a origem e saber se a visita está incluída no reparo.”'
  },
  {
    slug: 'diarista/guarulhos',
    label: 'Diarista em Guarulhos',
    prices: 'Para limpeza de rotina em imóvel de até 60 m², a Cronoshare publica R$ 120 a R$ 180 por visita em Guarulhos, com produtos fornecidos pelo cliente.',
    sources: [['Cronoshare', 'https://www.cronoshare.com.br/servicos/liimpeza-residencial/sao-paulo/guarulhos']],
    compare: 'Compare propostas com a mesma lista de tarefas e confirme quantas horas estão incluídas. Se precisar limpar forno, vidros ou armários por dentro, pergunte se isso cabe na visita ou muda o valor.',
    example: 'Exemplo de pedido: “Apartamento na Vila Galvão, dois quartos e um banheiro. Preciso de faxina de rotina na sexta. Tenho os produtos e posso deixar a entrada liberada na portaria.”'
  },
  {
    slug: 'limpeza-de-sofa/sao-bernardo-do-campo',
    label: 'Limpeza de sofá em São Bernardo do Campo',
    prices: 'Dois anúncios locais publicam preços iniciais para limpeza de sofá em São Bernardo do Campo: R$ 149,90 no Guia São Bernardo e R$ 189,99 na Clean Brasil.',
    sources: [
      ['Guia São Bernardo', 'https://www.guiasaobernardodocampo.com.br/limpeza-de-estofados'],
      ['Clean Brasil', 'https://cleanbrasil.com.br/limpeza-de-sofa-em-sao-bernardo-do-campo']
    ],
    compare: 'Compare o total para o mesmo sofá, incluindo chaise, almofadas soltas e deslocamento. Pergunte quanto tempo o sofá deve ficar sem uso e se a impermeabilização é cobrada separadamente.',
    example: 'Exemplo de pedido: “Sofá retrátil de três lugares no Rudge Ramos. Tem manchas no assento e o ambiente tem pouca ventilação. Preciso saber o valor para a peça inteira e o tempo de secagem.”'
  }
];
for (const [slug,question,answer,related] of entries) {
  const url=origin+'/servicos/'+slug+'/';
  if(!sitemap.includes('<loc>'+url+'</loc>')) throw Error('SEO orgânico: URL não consta do sitemap: '+slug);
  const file=path.join(root,'servicos',slug,'index.html');
  if(!fs.existsSync(file)) throw Error('SEO orgânico: arquivo ausente: '+slug);
  let html=fs.readFileSync(file,'utf8');
  if(!html.includes('rel="canonical" href="'+url+'"'))throw Error('SEO orgânico: canonical inválida: '+slug);
  if(!/<meta name="robots" content="index,follow"/.test(html))throw Error('SEO orgânico: URL não indexável: '+slug);
  if(!html.includes('id="seo-order"')||!html.includes('href="#pedido"'))throw Error('SEO orgânico: formulário ausente: '+slug);
  if(!html.includes('<article class="seo-content">')||!html.includes('</article>'))throw Error('SEO orgânico: estrutura editorial ausente: '+slug);
  if(html.includes('data-qf-organico-20261113'))throw Error('SEO orgânico: conteúdo duplicado: '+slug);
  const relatedUrl='/servicos/'+related+'/';
  const section='<section class="seo-practical" data-qf-organico-20261113><h2>'+esc(question)+'</h2><p>'+esc(answer)+'</p><p>Para receber propostas, informe o CEP, escolha o prazo e descreva seu pedido no formulário desta página. A publicação é gratuita; o atendimento depende da disponibilidade de profissionais na região.</p><p><a href="'+relatedUrl+'">Veja também outra região atendida</a> ou <a href="/servicos/">consulte as categorias de serviços</a>.</p></section>';
  html=html.replace('</article>',section+'</article>');
  fs.writeFileSync(file,html);
}
const editorialStart = '<article class="seo-content">';
let localGuides = 0;
for (const { slug, label, prices, sources, compare, example } of localBudgets) {
  const url = '/servicos/' + slug + '/';
  const canonical = origin + url;
  const file = path.join(root, url, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  if (!sitemap.includes('<loc>' + canonical + '</loc>')) continue;
  if (!html.includes('rel="canonical" href="' + canonical + '"') ||
      !html.includes('<meta name="robots" content="index,follow">') ||
      !html.includes('id="seo-order"') || !html.includes('href="#pedido"') ||
      !html.includes(editorialStart)) {
    throw Error('Orçamento local: página inválida ' + slug);
  }
  const references = sources.map(([name, href]) => '<a href="' + esc(href) + '">' + esc(name) + '</a>').join(' e ');
  const section = '<section class="seo-practical" data-qf-orcamento-local>' +
    '<h2>' + esc(label) + ': referências de preço</h2><p>' + esc(prices) + '</p>' +
    '<p>Referências externas consultadas em novembro de 2026: ' + references +
    '. Os preços publicados podem mudar. Cada profissional informa o valor do seu serviço.</p>' +
    '<h3>Como comparar as propostas</h3><p>' + esc(compare) + '</p><p>' + esc(example) +
    '</p><p><a href="#pedido">Pedir orçamento grátis</a></p></section>';
  fs.writeFileSync(file, html.replace(editorialStart, editorialStart + section));

  const city = slug.split('/')[1];
  const cityFile = path.join(root, 'servicos', 'cidades', city, 'index.html');
  const cityHtml = fs.readFileSync(cityFile, 'utf8');
  if (!cityHtml.includes(editorialStart) || !cityHtml.includes('<meta name="robots" content="index,follow">')) {
    throw Error('Orçamento local: guia da cidade inválido ' + city);
  }
  const cityLink = '<p><a href="' + url + '">' + esc(label) + '</a> — veja referências de preço e o que incluir no pedido.</p>';
  fs.writeFileSync(cityFile, cityHtml.replace(editorialStart, editorialStart + cityLink));
  localGuides++;
}
console.log('SEO orgânico: '+entries.length+' páginas locais reforçadas e '+localGuides+' guias de orçamento.');
