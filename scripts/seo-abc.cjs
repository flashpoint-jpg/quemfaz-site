// SEO pós-build (V11.96): serviços prioritários no Grande ABC.
// - 7 guias regionais (/servicos/<servico>/abc/) com conteúdo próprio de cada serviço,
//   em vez de dezenas de páginas iguais trocando só o nome da cidade.
// - Páginas locais finas desses serviços nas 6 cidades do ABC apontam (canonical) para o guia
//   ou para a página editorial da cidade, e saem do sitemap. Nada é apagado: o link continua abrindo.
// - Todas as páginas públicas de serviço passam adiante UTM e identificadores de clique (gclid, msclkid…)
//   para o formulário, sem isso o pedido vindo de anúncio em página de serviço perdia a origem.
// Sem números inventados, depoimentos ou promessa de profissional verificado.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dist');
const domain = 'https://quemfazservico.com.br';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonLd = o => JSON.stringify(o).replace(/</g, '\\u003c');

const CIDADES = [
  { nome: 'Santo André', slug: 'santo-andre', ibge: '3547809' },
  { nome: 'São Bernardo do Campo', slug: 'sao-bernardo-do-campo', ibge: '3548708' },
  { nome: 'Mauá', slug: 'maua', ibge: '3529401' },
  { nome: 'Diadema', slug: 'diadema', ibge: '3513801' },
  { nome: 'Ribeirão Pires', slug: 'ribeirao-pires', ibge: '3543303' },
  { nome: 'Rio Grande da Serra', slug: 'rio-grande-da-serra', ibge: '3544103' }
];

// Bairros oficiais (IBGE, Censo 2022 — data/localidades.json). Só exemplos, sem prometer atendimento.
const localidades = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'localidades.json'), 'utf8'));
function bairrosExemplo(c) {
  const lista = (localidades.bairros[c.ibge] || []).filter(b => !/^RP\d+|Regiões de Planejamento/.test(b));
  const preferidos = {
    '3547809': ['Centro', 'Campestre', 'Jardim', 'Utinga', 'Vila Assunção', 'Parque das Nações'],
    '3548708': ['Centro', 'Rudge Ramos', 'Baeta Neves', 'Assunção', 'Nova Petrópolis', 'Planalto'],
    '3513801': ['Centro', 'Piraporinha', 'Eldorado', 'Serraria', 'Taboão', 'Canhema'],
    '3543303': ['Centro', 'Santa Luzia', 'Suíssa', 'Pastoril', 'Ouro Fino Paulista']
  }[c.ibge] || [];
  const escolhidos = preferidos.filter(b => lista.includes(b));
  for (const b of lista) { if (escolhidos.length >= 6) break; if (!escolhidos.includes(b)) escolhidos.push(b); }
  return escolhidos;
}

// Páginas editoriais por cidade que já existem (scripts/improve-local-pages.cjs).
const EDITORIAIS = new Set(['eletricista/santo-andre', 'eletricista/diadema', 'encanador/sao-bernardo-do-campo', 'diarista/santo-andre', 'pintor/maua', 'pintor/diadema', 'limpeza-de-sofa/sao-bernardo-do-campo']);

const SERVICOS = [
  {
    slug: 'limpeza-de-sofa', cat: 'cat_limpeza_estofados', nome: 'Limpeza e higienização de sofá', curto: 'limpeza de sofá',
    duplicados: ['limpeza-de-sofa', 'higienizacao-de-sofa'],
    lead: 'Mancha, cheiro de xixi de pet, poeira acumulada ou só a limpeza do ano? Descreva o seu sofá e receba contatos de quem faz limpeza e higienização no ABC.',
    quando: ['Manchas de bebida, gordura ou caneta', 'Odor de suor, mofo ou urina de animais', 'Sofá retrátil ou reclinável com sujeira nas dobras', 'Antes de mudar, vender ou depois de reforma', 'Alergias: ácaros e poeira acumulada no tecido'],
    informar: ['Quantos lugares tem o sofá e se é retrátil, reclinável ou de canto', 'Tecido, se souber (suede, linho, veludo, couro, sintético)', 'Quais manchas ou odores quer tratar e há quanto tempo existem', 'Se também quer limpar cadeiras, poltronas, colchão ou tapete no mesmo dia'],
    comparar: 'Pergunte qual método será usado (extração, a seco ou vapor) e se ele serve para o seu tecido, quanto tempo leva para secar e se o preço é por lugar ou pelo sofá inteiro. Confirme se o deslocamento está incluído.',
    cuidados: ['Peça um teste numa parte escondida antes de aplicar produto no sofá todo.', 'Abra janelas e evite sentar até secar; a secagem depende do tecido, do clima e da ventilação.', 'Mancha antiga ou de tinta pode não sair por completo: alinhe a expectativa antes de fechar.'],
    faq: [['Higienização e limpeza de sofá são a mesma coisa?', 'Na prática os profissionais usam os dois nomes. Higienização costuma incluir produto para reduzir ácaros, bactérias e odores, além da limpeza da sujeira visível. Pergunte o que está incluído.'], ['Quanto tempo o sofá leva para secar?', 'Depende do tecido, do método e da ventilação do ambiente. Pergunte a estimativa ao profissional antes de agendar.']]
  },
  {
    slug: 'limpeza-de-estofados-e-tapetes', cat: 'cat_limpeza_estofados', nome: 'Limpeza de estofados', curto: 'limpeza de estofados',
    duplicados: ['limpeza-de-estofado'],
    lead: 'Poltronas, cadeiras de jantar, colchão, banco de carro ou tapete: descreva as peças e encontre quem faz limpeza de estofados no ABC.',
    quando: ['Cadeiras estofadas da sala de jantar encardidas', 'Colchão com manchas ou odor', 'Poltrona, puff ou cabeceira de cama', 'Tapete com pelos de animais ou manchas', 'Estofado de escritório ou consultório'],
    informar: ['Quais peças e quantas de cada (ex.: 6 cadeiras, 1 colchão de casal)', 'Material, se souber, e se há etiqueta com instrução de limpeza', 'Medida aproximada do tapete e se pode ser levado para lavar', 'Manchas ou odores que mais incomodam'],
    comparar: 'Peça o preço por peça e o total, pergunte se a limpeza é feita no local ou com retirada (tapetes) e qual o prazo de devolução. Compare propostas com as mesmas peças.',
    cuidados: ['Tecidos delicados e couro pedem produtos específicos: informe o material.', 'Colchão precisa de boa ventilação para secar antes de voltar a ser usado.', 'Em tapete com retirada, combine por escrito a data de entrega.'],
    faq: [['Dá para limpar colchão e sofá no mesmo atendimento?', 'Sim, desde que você informe todas as peças no pedido. Assim o profissional calcula o tempo e o preço de uma vez.'], ['Tapete é lavado em casa?', 'Alguns profissionais limpam no local, outros retiram e devolvem lavado. Diga no pedido o que prefere.']]
  },
  {
    slug: 'eletricista', cat: 'cat_eletricista', nome: 'Eletricista', curto: 'eletricista',
    duplicados: [],
    lead: 'Disjuntor desarmando, tomada esquentando, chuveiro que não esquenta ou instalação nova? Conte o problema e fale com eletricistas que atendem o ABC.',
    quando: ['Disjuntor que desarma ou queda de energia em parte da casa', 'Troca de chuveiro, resistência ou instalação de chuveiro novo', 'Tomadas, interruptores e pontos de luz novos', 'Instalação de luminárias, ventilador de teto ou lustre', 'Quadro de distribuição antigo ou revisão antes de mudar'],
    informar: ['O que acontece, desde quando e em quais cômodos', 'Quantos pontos (tomadas, luminárias) e se o material já foi comprado', 'Se é casa, apartamento ou comércio e se o prédio exige autorização do síndico', 'Fotos ajudam, mas não são obrigatórias para publicar'],
    comparar: 'Peça que o orçamento separe diagnóstico, mão de obra e material. Pergunte se o serviço segue a norma de instalações elétricas de baixa tensão (ABNT NBR 5410) e se há garantia do serviço.',
    cuidados: ['Em caso de cheiro de queimado ou faísca, desligue o disjuntor geral e não use a tomada até a avaliação.', 'Não aceite emendas expostas nem fio mais fino que o indicado para o chuveiro.', 'Confirme se vai haver cobrança de visita antes do profissional ir até o local.'],
    faq: [['Eletricista cobra visita?', 'Alguns cobram a avaliação, outros só o serviço. Pergunte antes de agendar e peça o valor total por escrito.'], ['Posso pedir eletricista para hoje?', 'Sim. No formulário, informe que precisa para hoje. O atendimento depende da agenda de quem responder.']]
  },
  {
    slug: 'encanador', cat: 'cat_encanador', nome: 'Encanador', curto: 'encanador',
    duplicados: [],
    lead: 'Vazamento, descarga correndo, registro pingando ou conta de água alta? Descreva o problema e receba contato de encanadores que atendem o ABC.',
    quando: ['Vazamento aparente, mancha de umidade na parede ou no teto', 'Descarga, válvula ou caixa acoplada com problema', 'Troca de torneira, registro, sifão ou rabicho', 'Conta de água alta sem motivo aparente', 'Instalação de máquina de lavar, filtro ou aquecedor'],
    informar: ['Onde está o problema (cozinha, banheiro, área de serviço, área externa)', 'Desde quando acontece e se a água já foi fechada no registro', 'Se o cano é embutido e pode precisar abrir parede ou piso', 'Se é casa ou apartamento e o andar'],
    comparar: 'Peça que a proposta separe mão de obra, peças e o eventual reparo de azulejo ou parede. Combine quem compra as peças e como o conserto será testado antes do pagamento.',
    cuidados: ['Em vazamento forte, feche o registro geral e desligue aparelhos elétricos próximos da água.', 'Para descobrir vazamento escondido, pergunte se o profissional faz teste ou caça-vazamento.', 'Guarde as peças trocadas até o fim do serviço, se quiser conferir.'],
    faq: [['O encanador precisa quebrar a parede?', 'Depende de onde está o vazamento. Peça que ele explique o motivo antes de quebrar e combine quem refaz o acabamento.'], ['Desentupimento também é com encanador?', 'Muitos encanadores fazem, mas também existem desentupidoras. Descreva o problema no pedido para chegar a quem atende.']]
  },
  {
    slug: 'pintor', cat: 'cat_pintor', nome: 'Pintor', curto: 'pintor',
    duplicados: [],
    lead: 'Vai pintar um cômodo, a casa toda, fachada ou muro? Descreva os ambientes e o estado das paredes para receber contatos de pintores que atendem o ABC.',
    quando: ['Pintura de apartamento ou casa para mudança', 'Paredes com mofo, bolhas ou descascando', 'Fachada, muro ou portão', 'Textura, grafiato ou cor de destaque numa parede', 'Retoque depois de reparo elétrico ou hidráulico'],
    informar: ['Quais ambientes, medida aproximada e se inclui teto, portas e janelas', 'Estado da parede: furos, trincas, umidade, descascado', 'Se a tinta já foi comprada ou deve entrar no orçamento', 'Se o imóvel estará vazio ou com móveis'],
    comparar: 'Compare propostas com o mesmo escopo: preparação (lixa, massa, selador), número de demãos, tipo de tinta, proteção de piso e móveis e limpeza ao final. Peça o prazo em dias.',
    cuidados: ['Mofo e bolha voltam se a causa (infiltração) não for resolvida antes da pintura.', 'Mantenha o ambiente ventilado durante e depois da pintura.', 'Combine por escrito quem compra a tinta e a quantidade estimada.'],
    faq: [['A tinta entra no orçamento?', 'Pode entrar ou ser comprada por você. Peça que a proposta diga a marca ou linha da tinta e a quantidade estimada.'], ['Quanto tempo leva para pintar um apartamento?', 'Depende do tamanho, do estado das paredes e do número de demãos. Peça o prazo na proposta.']]
  },
  {
    slug: 'diarista', cat: 'cat_diarista', nome: 'Diarista e limpeza residencial', curto: 'diarista',
    duplicados: ['faxineira'],
    lead: 'Faxina de rotina, limpeza pesada, pós-mudança ou casa vazia? Conte o tamanho do imóvel e as tarefas e encontre diaristas que atendem o ABC.',
    quando: ['Faxina semanal ou quinzenal', 'Limpeza pesada antes de receber visitas', 'Imóvel vazio para entrar ou entregar (mudança)', 'Limpeza de vidros, armários por dentro e eletrodomésticos', 'Passar roupa junto com a faxina'],
    informar: ['Quantos quartos, banheiros e se é casa ou apartamento', 'Se é limpeza de rotina, pesada ou de imóvel vazio', 'Tarefas extras: vidros, armários, geladeira, forno, passar roupa', 'Se você fornece os produtos e equipamentos'],
    comparar: 'Combine as tarefas incluídas, o horário de início e fim, quem fornece produtos e se transporte está no valor. Para limpeza pesada, peça o preço antes, pela descrição ou fotos.',
    cuidados: ['Diarista que trabalha até 2 dias por semana na mesma casa não é empregada doméstica pela Lei Complementar 150/2015; acima disso, a relação muda.', 'Deixe claro o que não deve ser mexido e guarde objetos de valor.', 'Combine a forma de pagamento (Pix, dinheiro) no fim do dia.'],
    faq: [['Diarista leva os produtos de limpeza?', 'Algumas levam, outras usam os seus. Informe no pedido o que você já tem em casa.'], ['Posso contratar a mesma diarista toda semana?', 'Sim. Depois do primeiro atendimento, você combina a frequência direto com a profissional.']]
  },
  {
    slug: 'marido-de-aluguel', cat: 'cat_marido_aluguel', nome: 'Instalação e manutenção residencial', curto: 'instalação e manutenção',
    duplicados: [],
    lead: 'Pendurar TV, instalar prateleira, cortina, chuveiro ou fazer vários pequenos reparos de uma vez? Faça uma lista e fale com profissionais de manutenção (marido de aluguel) no ABC.',
    quando: ['Instalar suporte de TV, prateleiras, quadros e espelhos', 'Instalar varal, cortina, persiana ou olho mágico', 'Trocar fechadura, maçaneta, torneira ou sifão', 'Regular porta e armário, trocar dobradiça', 'Lista de pequenos reparos acumulados na casa'],
    informar: ['A lista de tarefas, com quantidade (ex.: 3 prateleiras, 1 suporte de TV de 55")', 'Tipo de parede: alvenaria, drywall ou azulejo', 'Se as peças e buchas já foram compradas', 'Altura, acesso e regras do condomínio para barulho'],
    comparar: 'Peça o preço pela lista inteira ou por hora e confirme o que está incluído (furadeira, buchas, nível). Para serviço elétrico ou hidráulico maior, prefira eletricista ou encanador.',
    cuidados: ['Antes de furar, verifique onde passam canos e fios; peça ao profissional para conferir.', 'Drywall precisa de bucha própria para peso: informe o tipo de parede.', 'Suporte de TV deve aguentar o peso e o tamanho da sua TV: confira na caixa.'],
    faq: [['O que é marido de aluguel?', 'É o profissional de pequenos reparos e instalações na casa. No QuemFaz você descreve a lista e quem atende a região entra em contato.'], ['Posso juntar várias tarefas num pedido só?', 'Sim, é o ideal. Liste todas no pedido para receber um preço do conjunto.']]
  }
];

const css = `*{box-sizing:border-box}body{margin:0;background:#F5F6FA;color:#07162F;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}a{color:#1458cc}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #FF7900;outline-offset:3px}
.top{background:#07162F;border-bottom:4px solid #FF7900}.top div{max-width:1040px;margin:auto;padding:14px 20px;display:flex;justify-content:space-between;align-items:center;gap:12px}.top a{color:#fff;text-decoration:none;font-weight:800;font-size:20px}.top a span{color:#FF9548}.top .alt{font-size:15px;font-weight:600}
main{max-width:1040px;margin:auto;padding:16px 20px 40px}.crumb{font-size:14px;margin:6px 0 14px}.hero{background:#07162F;color:#fff;border-radius:22px;padding:clamp(22px,5vw,46px)}.hero .tag{color:#FFB47F;font-weight:700;font-size:14px}h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:12px 0}.hero p{color:#E3EAF6;max-width:720px;font-size:17px}
.cta{display:inline-flex;align-items:center;justify-content:center;min-height:52px;padding:12px 24px;border-radius:12px;background:#FF7900;color:#1a0c00;font-weight:800;text-decoration:none;margin:10px 0;font-size:17px}.note{font-size:14px;opacity:.95}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin:18px 0}.card{background:#fff;border:1px solid #E2E6EE;border-radius:18px;padding:clamp(18px,4vw,28px)}.full{margin:18px 0}h2{font-size:22px;line-height:1.3;margin:0 0 10px}h3{font-size:18px;margin:16px 0 4px}ul,ol{padding-left:22px}li{margin:6px 0}
.steps{counter-reset:p;list-style:none;padding:0}.steps li{counter-increment:p;position:relative;padding-left:44px;margin:12px 0}.steps li:before{content:counter(p);position:absolute;left:0;top:0;width:32px;height:32px;border-radius:50%;background:#1764D8;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center}
.cidades{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;list-style:none;padding:0}.cidades li{background:#F5F6FA;border-radius:12px;padding:12px 14px;margin:0}.cidades a{font-weight:700}.cidades small{display:block;color:#4A5870;font-size:13px;line-height:1.45;margin-top:4px}
details{border-bottom:1px solid #E2E6EE;padding:14px 0}summary{font-weight:700;cursor:pointer;min-height:24px}.trust li{margin:10px 0}.end{text-align:center}footer{max-width:1040px;margin:auto;padding:0 20px 32px;font-size:14px;color:#4A5870}
@media(max-width:720px){.grid{grid-template-columns:1fr}.top .alt{display:none}.cta{width:100%}}`;

// Bloco de confiança: somente o que o sistema realmente faz.
const confianca = `<section class="card full" aria-labelledby="conf"><h2 id="conf">Contratar com segurança</h2><ul class="trust">
<li><strong>Publicar é grátis.</strong> Você não paga nada para pedir orçamentos. O serviço é combinado e pago direto ao profissional. Existe a opção de pedido urgente, paga e opcional.</li>
<li><strong>Seu WhatsApp não fica público.</strong> Ele só é liberado para os profissionais que pegarem o seu pedido, até a quantidade de orçamentos que você escolher (de 1 a 4).</li>
<li><strong>Selo de verificado.</strong> Alguns profissionais têm o selo "Verificado pela QuemFaz", dado depois da conferência de documentos. Nem todos têm: confira o perfil antes de fechar.</li>
<li><strong>Antes de pagar:</strong> peça o orçamento por escrito no WhatsApp, combine o que está incluído e evite pagar o valor total adiantado.</li>
<li><strong>Avaliação:</strong> depois do serviço, você pode dar nota ao profissional e ajudar outros clientes.</li>
</ul><p class="note">Leia a <a href="/privacidade/">Política de privacidade</a>.</p></section>`;

const passaUtm = `<script>(function(){try{var q=new URLSearchParams(location.search),k=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','gbraid','wbraid','msclkid','fbclid','ttclid'],e=[];k.forEach(function(n){var v=q.get(n);if(v)e.push([n,v.slice(0,500)]);});if(!e.length)return;document.querySelectorAll('a[data-request],a[data-qf-seo-cta]').forEach(function(a){var u=new URL(a.getAttribute('href'),location.origin);e.forEach(function(p){if(!u.searchParams.has(p[0]))u.searchParams.set(p[0],p[1]);});a.setAttribute('href',u.pathname+u.search+u.hash);});}catch(_){}})();</script>`;

function ctaHref(s, route) {
  return '/?' + new URLSearchParams({ servico: s.cat, seo_page: route }).toString() + '#/auth/cliente/cadastro';
}

function hubHtml(s) {
  const route = '/servicos/' + s.slug + '/abc/';
  const url = domain + route;
  const title = s.nome + ' no ABC: Santo André, São Bernardo, Mauá e Diadema | Quem Faz';
  const desc = s.nome + ' em Santo André, São Bernardo, Mauá, Diadema, Ribeirão Pires e Rio Grande da Serra. Pedido grátis, contato no WhatsApp.';
  const cta = '<a class="cta" data-request href="' + esc(ctaHref(s, route)) + '">Publicar pedido grátis</a>';
  const cidades = CIDADES.map(c => {
    const key = s.slug + '/' + c.slug;
    const editorial = EDITORIAIS.has(key);
    const bairros = bairrosExemplo(c);
    const link = editorial ? '<a href="/servicos/' + key + '/">' + esc(s.curto.charAt(0).toUpperCase() + s.curto.slice(1)) + ' em ' + esc(c.nome) + '</a>' : '<strong>' + esc(c.nome) + '</strong>';
    return '<li>' + link + '<small>' + (bairros.length ? 'Informe o seu bairro, como ' + esc(bairros.slice(0, 4).join(', ')) + '.' : 'Informe o seu bairro ou CEP no pedido.') + '</small></li>';
  }).join('');
  const faq = [
    ['Quanto custa publicar o pedido?', 'Nada. Publicar e receber contatos é grátis para o cliente. O preço do serviço é combinado direto com o profissional.'],
    ['Quantos profissionais vão me chamar?', 'Você escolhe de 1 a 4 orçamentos. O contato depende de haver profissional disponível que atenda o seu bairro no momento.'],
    ['Como o profissional entra em contato?', 'Quem pegar o seu pedido chama você no WhatsApp com uma mensagem pronta. Você conversa, pede o orçamento e decide se contrata.'],
    ['Preciso criar conta ou baixar aplicativo?', 'Não. O pedido é feito pelo site, com seu nome, bairro e WhatsApp.'],
    ...s.faq
  ];
  const schema = [
    { '@context': 'https://schema.org', '@type': 'Service', name: s.nome + ' no ABC', serviceType: s.nome, url, description: desc,
      areaServed: CIDADES.map(c => ({ '@type': 'City', name: c.nome, containedInPlace: { '@type': 'State', name: 'São Paulo' } })),
      provider: { '@type': 'Organization', name: 'Quem Faz', url: domain + '/', logo: domain + '/icon-512.png' },
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL', description: 'Publicação do pedido gratuita para o cliente' } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Início', item: domain + '/' },
      { '@type': 'ListItem', position: 2, name: 'Serviços', item: domain + '/servicos/' },
      { '@type': 'ListItem', position: 3, name: s.nome + ' no ABC', item: url }] },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  ];
  const outros = SERVICOS.filter(x => x.slug !== s.slug).map(x => '<a href="/servicos/' + x.slug + '/abc/">' + esc(x.nome) + '</a>').join(' · ');
  const script = `<script>document.querySelectorAll('[data-request]').forEach(function(a){a.addEventListener('click',function(){try{sessionStorage.setItem('qf_pending_category',${JSON.stringify(s.cat)});sessionStorage.removeItem('qf_client_search_region');sessionStorage.removeItem('qf_repeat_order_draft');}catch(e){}});});</script>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${url}"><link rel="icon" type="image/png" sizes="48x48" href="/favicon.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><meta name="theme-color" content="#07162F"><meta property="og:type" content="website"><meta property="og:locale" content="pt_BR"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}"><meta property="og:image" content="${domain}/icon-512.png"><script type="application/ld+json">${jsonLd(schema)}</script><style>${css}</style></head><body data-qf-seo="abc"><header class="top"><div><a href="/" aria-label="QuemFaz - página inicial">Quem<span>Faz</span></a><a class="alt" href="/servicos/">Todos os serviços</a></div></header><main>
<nav class="crumb" aria-label="Você está em"><a href="/">Início</a> / <a href="/servicos/">Serviços</a> / ${esc(s.nome)} no ABC</nav>
<section class="hero"><div class="tag">Grande ABC · SP</div><h1>${esc(s.nome)} no ABC</h1><p>${esc(s.lead)}</p>${cta}<p class="note">Grátis para o cliente · sem cadastro · você escolhe de 1 a 4 orçamentos</p></section>
<section class="card full" aria-labelledby="como"><h2 id="como">Como funciona o QuemFaz</h2><ol class="steps"><li><strong>Você publica o pedido.</strong> Conta o que precisa, o bairro, para quando e quantos orçamentos quer receber.</li><li><strong>Os profissionais recebem.</strong> O pedido é avisado aos profissionais cadastrados nesse serviço que atendem a sua região.</li><li><strong>Quem pegar o pedido chama você no WhatsApp.</strong> Seu número só é liberado para quem pegar, até a quantidade que você escolheu.</li><li><strong>Você compara e decide.</strong> Combina preço, data e forma de pagamento direto com o profissional. Não é obrigado a contratar.</li></ol></section>
<div class="grid"><section class="card"><h2>Quando chamar</h2><ul>${s.quando.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></section><section class="card"><h2>O que escrever no pedido</h2><ul>${s.informar.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></section></div>
<div class="grid"><section class="card"><h2>Como comparar os orçamentos</h2><p>${esc(s.comparar)}</p></section><section class="card"><h2>Cuidados importantes</h2><ul>${s.cuidados.map(x => '<li>' + esc(x) + '</li>').join('')}</ul></section></div>
<section class="card full" aria-labelledby="cid"><h2 id="cid">Cidades do ABC</h2><p>Publique informando o seu bairro. A disponibilidade depende dos profissionais ativos que atendem a região no momento.</p><ul class="cidades">${cidades}</ul><p class="note">Nomes de bairros: IBGE, Censo 2022.</p></section>
${confianca}
<section class="card full" aria-labelledby="duv"><h2 id="duv">Dúvidas frequentes</h2>${faq.map(([q, a]) => '<details><summary>' + esc(q) + '</summary><p>' + esc(a) + '</p></details>').join('')}</section>
<section class="card full end"><h2>Precisa de ${esc(s.curto)} no ABC?</h2><p>É grátis e não precisa criar conta.</p>${cta}</section>
<p class="note">Outros serviços no ABC: ${outros}</p></main><footer>QuemFaz · <a href="/privacidade/">Privacidade</a> · <a href="/servicos/">Serviços</a></footer>${script}</body></html>`;
}

// Serviços do ABC no sitemap.
const mapFile = path.join(root, 'sitemap.xml');
let sitemap = fs.readFileSync(mapFile, 'utf8');
function addLoc(u) { if (!sitemap.includes('<loc>' + u + '</loc>')) sitemap = sitemap.replace('</urlset>', '  <url><loc>' + u + '</loc></url>\n</urlset>'); }
function removeLoc(u) { sitemap = sitemap.replace(new RegExp('\\s*<url>\\s*<loc>' + u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</loc>\\s*</url>', 'g'), ''); }

let hubs = 0, consolidadas = 0;
for (const s of SERVICOS) {
  const dir = path.join(root, 'servicos', s.slug, 'abc');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), hubHtml(s));
  addLoc(domain + '/servicos/' + s.slug + '/abc/');
  hubs++;
  for (const c of CIDADES) {
    const key = s.slug + '/' + c.slug;
    const destino = domain + (EDITORIAIS.has(key) ? '/servicos/' + key + '/' : '/servicos/' + s.slug + '/abc/');
    if (EDITORIAIS.has(key)) addLoc(destino); // ex.: limpeza de sofá em SBC estava fora do sitemap
    const candidatos = [['servicos', s.slug, c.slug], ...s.duplicados.map(d => [d, c.slug])];
    for (const parts of candidatos) {
      const file = path.join(root, ...parts, 'index.html');
      const pageUrl = domain + '/' + parts.join('/') + '/';
      if (!fs.existsSync(file) || pageUrl === destino) continue;
      let html = fs.readFileSync(file, 'utf8');
      html = html.replace(/<link rel="canonical" href="[^"]+">/, '<link rel="canonical" href="' + destino + '">');
      if (!html.includes('data-qf-guia-abc')) {
        const aviso = '<p data-qf-guia-abc style="background:#FFF4EA;border:1px solid #FFD2AD;border-radius:12px;padding:12px 14px;margin:12px 0"><a href="' + destino.replace(domain, '') + '" style="font-weight:700">Veja o guia completo: ' + esc(s.nome) + (EDITORIAIS.has(key) ? ' em ' + esc(c.nome) : ' no ABC') + '</a></p>';
        html = html.replace(/<h1>/, aviso + '<h1>');
      }
      fs.writeFileSync(file, html);
      removeLoc(pageUrl);
      consolidadas++;
    }
  }
}

// Editoriais por cidade ganham link para o guia regional.
for (const key of EDITORIAIS) {
  const file = path.join(root, 'servicos', key, 'index.html');
  if (!fs.existsSync(file)) continue;
  const slug = key.split('/')[0];
  const s = SERVICOS.find(x => x.slug === slug);
  let html = fs.readFileSync(file, 'utf8');
  if (s && !html.includes('/servicos/' + slug + '/abc/')) {
    html = html.replace('</main>', '<p style="margin:20px 0"><a href="/servicos/' + slug + '/abc/" style="font-weight:700">' + esc(s.nome) + ' em outras cidades do ABC</a></p></main>');
    fs.writeFileSync(file, html);
  }
}

// Passa UTM e identificadores de clique adiante em todas as páginas públicas de serviço.
let utm = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'index.html' && p !== path.join(root, 'index.html')) {
      let html = fs.readFileSync(p, 'utf8');
      if (!/data-request|data-qf-seo-cta/.test(html) || html.includes("'msclkid','fbclid'")) continue;
      html = html.replace('</body>', passaUtm + '</body>');
      fs.writeFileSync(p, html);
      utm++;
    }
  }
}
walk(root);

// Página /servicos/ ganha os guias do ABC no topo.
const hubIndex = path.join(root, 'servicos', 'index.html');
if (fs.existsSync(hubIndex)) {
  let html = fs.readFileSync(hubIndex, 'utf8');
  if (!html.includes('data-qf-abc-guias')) {
    const bloco = '<section data-qf-abc-guias style="background:#fff;border:1px solid #E2E6EE;border-radius:16px;padding:18px 20px;margin:18px 0"><h2 style="margin-top:0">Guias do Grande ABC</h2><ul>' + SERVICOS.map(x => '<li><a href="/servicos/' + x.slug + '/abc/">' + esc(x.nome) + ' no ABC</a></li>').join('') + '</ul></section>';
    html = html.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/, '$1' + bloco);
    fs.writeFileSync(hubIndex, html);
  }
}

fs.writeFileSync(mapFile, sitemap);
if (hubs !== SERVICOS.length || consolidadas < 30 || utm < 500) throw Error('SEO ABC: verificação falhou (' + hubs + ' guias, ' + consolidadas + ' consolidadas, ' + utm + ' páginas com UTM)');
console.log('SEO ABC: ' + hubs + ' guias regionais, ' + consolidadas + ' páginas finas consolidadas, ' + utm + ' páginas passando UTM/gclid/msclkid ao formulário.');
