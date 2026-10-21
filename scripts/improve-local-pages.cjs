// Conteúdo editorial das páginas prioritárias; aplicado após os geradores gerais.
const fs = require('node:fs');
const path = require('node:path');
const services = {
 eletricista: {name:'Eletricista', category:'cat_eletricista', lead:'Tomadas, iluminação ou um problema na instalação elétrica? Explique o que precisa e compare propostas antes de contratar.', items:['Qual é o problema e em quais cômodos ele acontece.','Quantidade de tomadas, luminárias ou pontos que precisam de serviço.','Tipo de imóvel, bairro e melhor período para receber o profissional.'], compare:'Pergunte se o orçamento inclui diagnóstico, mão de obra, materiais e eventual retorno. Confirme a experiência do profissional com o tipo de instalação do seu imóvel.', question:'O profissional pode avaliar o problema antes de dar o preço?', answer:'Combine a avaliação diretamente com o profissional e pergunte antes se existe cobrança pela visita. O valor final depende do problema identificado e do que será necessário executar.'},
 encanador: {name:'Encanador', category:'cat_encanador', lead:'Vazamento, torneira ou descarga com problema? Conte onde acontece e encontre profissionais que atendem sua região.', items:['Onde está o problema: cozinha, banheiro, área de serviço ou outra parte do imóvel.','Quando começou e se existe vazamento aparente.','Se o acesso à tubulação está livre ou pode exigir abertura de parede.'], compare:'Peça que a proposta discrimine mão de obra, peças e eventual reparo de parede ou revestimento. Combine quem compra os materiais e como será feita a conferência após o serviço.', question:'É necessário trocar toda a tubulação?', answer:'Isso depende da avaliação do problema. Descreva os sinais que percebeu e peça ao profissional que explique o reparo proposto antes de autorizar a execução.'},
 diarista: {name:'Diarista', category:'cat_diarista', lead:'Precisa de ajuda com a faxina? Informe o tamanho da casa, as tarefas e o dia desejado para combinar uma limpeza do seu jeito.', items:['Quantidade de quartos, banheiros e tamanho aproximado do imóvel.','Se é limpeza de rotina, pesada ou de um imóvel vazio.','Tarefas extras, como janelas, armários por dentro ou passar roupas.'], compare:'Combine as tarefas incluídas, duração prevista, produtos e equipamentos necessários. Confirme se deslocamento e tarefas extras estão incluídos no valor.', question:'Produtos de limpeza estão incluídos?', answer:'Isso deve ser combinado com a profissional. Informe quais produtos e equipamentos você tem e confirme o que será necessário providenciar antes da visita.'},
 pintor: {name:'Pintor', category:'cat_pintor', lead:'Vai renovar a pintura? Descreva os ambientes e o estado das paredes para receber propostas com um escopo bem definido.', items:['Quais ambientes serão pintados e suas medidas aproximadas.','Estado da superfície: descascamento, manchas ou necessidade de preparação.','Se o serviço inclui teto, portas, proteção de móveis e limpeza final.'], compare:'Compare propostas que incluam as mesmas superfícies e etapas. Confirme preparação, materiais, acabamento, prazo e quem compra a tinta.', question:'A tinta está incluída no orçamento?', answer:'Pode estar incluída ou ser comprada à parte. Peça que a proposta indique marca ou especificação combinada, quantidade estimada e responsabilidade pela compra.'},
 'limpeza-de-sofa': {name:'Limpeza de sofá', category:'cat_limpeza_estofados', lead:'Seu sofá precisa de limpeza? Informe o tipo de estofado, tamanho e manchas para conversar com profissionais da região.', items:['Quantidade de lugares, modelo do sofá e tecido, se souber.','Presença de manchas, odores ou pelos de animais.','Se também deseja limpar cadeiras, poltronas ou colchões.'], compare:'Pergunte qual método é adequado ao tecido, tempo estimado de secagem e cuidados após a limpeza. Confirme deslocamento e valor de peças adicionais.', question:'Todas as manchas saem na limpeza?', answer:'O resultado depende do tecido, da origem e do tempo da mancha. Peça uma avaliação e alinhe as expectativas antes de contratar; não presuma remoção total.'}
};
const pages=[['eletricista','santo-andre','Santo André'],['eletricista','diadema','Diadema'],['encanador','sao-bernardo-do-campo','São Bernardo do Campo'],['diarista','santo-andre','Santo André'],['pintor','maua','Mauá'],['pintor','diadema','Diadema'],['limpeza-de-sofa','sao-bernardo-do-campo','São Bernardo do Campo']];
const editoriais = {
  "eletricista/santo-andre": {
    "lead": "Vai trocar chuveiro, instalar luminárias ou acrescentar tomadas em Santo André? Descreva cada ponto para comparar o serviço completo, incluindo as verificações necessárias na instalação.",
    "heading": "Instalações e trocas: defina cada ponto do serviço",
    "scenarios": [
      "Chuveiro: informe o modelo, a tensão indicada no aparelho e se é troca ou primeira instalação. A compatibilidade da instalação deve ser avaliada pelo eletricista.",
      "Iluminação: conte quantas luminárias serão instaladas, a altura do teto e se há pontos prontos.",
      "Tomadas: explique quais equipamentos serão ligados e se deseja trocar uma tomada existente ou criar um ponto novo."
    ],
    "example": "Preciso de eletricista em Santo André, no bairro [bairro], para trocar um chuveiro e instalar duas luminárias. É um apartamento, com horário de serviço a combinar com o condomínio. Já tenho os aparelhos e quero saber se materiais e avaliação da instalação estão incluídos.",
    "checklist": [
      "Separe modelo e informações dos aparelhos, sem desmontar tomadas ou abrir o quadro.",
      "Informe se o condomínio exige cadastro do prestador e quais horários permite.",
      "Peça que a proposta distinga instalação, materiais adicionais e correções identificadas na avaliação."
    ],
    "question": "Trocar o chuveiro e instalar uma luminária entram no mesmo pedido?",
    "answer": "Sim. Liste cada tarefa e quantidade no mesmo pedido. O profissional poderá avaliar o conjunto, informar o que consegue executar e separar os custos. Não presuma que o preço de uma troca inclua adequações de fiação."
  },
  "eletricista/diadema": {
    "lead": "A luz cai quando um aparelho é ligado ou uma tomada parou de funcionar em Diadema? Relate os sinais e quando ocorrem para pedir uma avaliação, antes de autorizar a troca de peças.",
    "heading": "Falhas elétricas: descreva o sintoma antes de pedir uma troca",
    "scenarios": [
      "Disjuntor que desarma: informe quais aparelhos estavam em uso e se a falha afeta o imóvel todo ou apenas um cômodo.",
      "Tomada sem energia: conte se outras tomadas e lâmpadas do ambiente continuam funcionando.",
      "Falha após uma instalação: diga qual aparelho ou serviço foi acrescentado e quando o problema começou."
    ],
    "example": "Procuro eletricista em Diadema, no bairro [bairro]. O disjuntor desarma quando uso [aparelho], desde [quando]. A falha afeta [cômodos]. Preciso de avaliação e orçamento separado para diagnóstico e reparo, em [dia/período].",
    "checklist": [
      "Anote os horários e os aparelhos em uso quando a falha acontece.",
      "Não repita o teste ligando um aparelho que apresenta falha ou aquecimento.",
      "Confirme se há cobrança pela visita, como o reparo será aprovado e se o teste final entra no orçamento."
    ],
    "question": "O disjuntor desarma: já peço a troca dele?",
    "answer": "Descreva o problema e peça uma avaliação. O desarme pode ter causas diferentes, e trocar uma peça sem diagnóstico pode não resolver. Combine o custo da visita e autorize o reparo depois de entender a proposta."
  },
  "encanador/sao-bernardo-do-campo": {
    "lead": "Vazamento na cozinha, descarga com defeito ou umidade em São Bernardo do Campo? Explique onde o sinal aparece e se a água corre continuamente para o profissional avaliar o reparo.",
    "heading": "Vazamento aparente ou umidade: o pedido muda conforme o sinal",
    "scenarios": [
      "Sifão, torneira ou flexível: informe onde pinga e se o vazamento ocorre somente durante o uso.",
      "Descarga: descreva se a água continua correndo, se o mecanismo não aciona ou se existe vazamento na base.",
      "Umidade sem origem visível: indique parede, teto ou piso e quando percebeu a mancha. A localização da causa pode exigir avaliação específica."
    ],
    "example": "Preciso de encanador em São Bernardo do Campo, bairro [bairro]. Há água sob a pia quando [situação]. O acesso ao sifão está [livre/limitado]. Quero orçamento com visita, mão de obra e peças discriminados, para [dia/período].",
    "checklist": [
      "Fotografe o ponto aparente e informe se há armário ou revestimento dificultando o acesso.",
      "Em condomínio, confira como funciona o acesso ao registro e eventual autorização para interrupção de água.",
      "Pergunte se o fechamento de parede ou a recomposição do revestimento fazem parte do serviço."
    ],
    "question": "Localizar o vazamento e fechar a parede estão incluídos?",
    "answer": "Não necessariamente. Peça que a proposta separe localização da origem, reparo hidráulico e recomposição do acabamento. Se a causa ainda não foi identificada, combine primeiro a avaliação e seu preço."
  },
  "diarista/santo-andre": {
    "lead": "Precisa de faxina de rotina ou limpeza de um imóvel vazio em Santo André? Organize as prioridades e as tarefas extras para combinar uma diária com escopo claro.",
    "heading": "Monte uma lista de prioridades para a diária",
    "scenarios": [
      "Faxina de rotina: diga quantos quartos e banheiros existem e quais ambientes precisam de mais atenção.",
      "Imóvel vazio ou pós-mudança: informe se há móveis, caixas, adesivos ou sujeira acumulada.",
      "Tarefas extras: vidros, armários por dentro, forno e passar roupa precisam ser combinados junto com o tempo disponível."
    ],
    "example": "Busco diarista em Santo André, bairro [bairro], para apartamento com [quantidade] quartos e [quantidade] banheiros. Prioridades: cozinha e banheiros. Gostaria de incluir [extra]. Tenho [produtos/equipamentos]. Disponibilidade em [dia/período].",
    "checklist": [
      "Defina o que precisa ficar pronto primeiro caso o tempo não seja suficiente para todas as tarefas.",
      "Combine produtos, equipamentos, transporte e duração prevista antes de confirmar.",
      "Informe animais no imóvel e restrições de acesso a cômodos ou objetos."
    ],
    "question": "Limpeza pós-obra é a mesma coisa que uma diária de rotina?",
    "answer": "Os trabalhos podem exigir tempos, produtos e equipamentos diferentes. Se houver resíduos de obra, detalhe isso no pedido. Consulte também o guia de limpeza no ABC e combine o escopo específico antes de contratar."
  },
  "pintor/maua": {
    "lead": "Vai pintar uma casa ou renovar os ambientes em Mauá? Informe as superfícies e o estado das paredes para comparar preparação, acabamento e limpeza final na mesma proposta.",
    "heading": "Paredes internas: preparação e acabamento precisam estar no orçamento",
    "scenarios": [
      "Mudança de cor: informe a cor atual, a desejada e se a tinta já foi escolhida.",
      "Parede descascando ou com fissuras: descreva onde acontece para o pintor avaliar a preparação necessária.",
      "Imóvel ocupado: diga quais móveis precisam ser protegidos e se os ambientes terão de ser liberados por etapas."
    ],
    "example": "Preciso de pintor em Mauá, bairro [bairro], para [ambientes/medidas aproximadas]. As paredes estão [estado] e quero mudar de [cor] para [cor]. O imóvel está [vazio/ocupado]. Quero comparar preparação, tinta, proteção e limpeza no orçamento.",
    "checklist": [
      "Liste separadamente paredes, tetos, portas e outras superfícies.",
      "Peça especificação de preparação, produto e acabamento; não compare apenas o valor total.",
      "Combine proteção de piso e móveis, retirada de resíduos e o que será feito se aparecer um problema na superfície."
    ],
    "question": "Posso comparar propostas por metro quadrado?",
    "answer": "Pode, desde que considerem as mesmas superfícies, preparação e materiais. Uma proposta só de mão de obra não equivale a outra com tinta, correções e limpeza. Informe medidas aproximadas e confirme o escopo antes de fechar."
  },
  "pintor/diadema": {
    "lead": "Precisa organizar a pintura de um apartamento em Diadema antes da mudança ou entrega das chaves? Informe o prazo, o estado dos ambientes e as regras de acesso para combinar as etapas.",
    "heading": "Pintura com data para entrega: organize o serviço por etapas",
    "scenarios": [
      "Antes da mudança: diga quando os ambientes estarão livres e qual é a data desejada para terminar.",
      "Entrega de imóvel: liste as superfícies e o acabamento que precisa ser orçado, conforme o que foi combinado para a entrega.",
      "Pintura com móveis: explique quais cômodos podem ser liberados e como será o acesso aos demais."
    ],
    "example": "Busco pintor em Diadema, bairro [bairro], para apartamento de [medidas]. Preciso finalizar até [data], sujeito à disponibilidade. Incluir [paredes/teto/portas], proteção e limpeza. O condomínio permite serviço em [horários]. Quero saber prazo por etapa e materiais necessários.",
    "checklist": [
      "Confirme horários para serviço, entrada do prestador e recebimento de materiais no condomínio.",
      "Combine início, etapas, intervalo entre aplicações indicado pelo produto e previsão de liberação dos ambientes.",
      "Peça que a proposta registre como serão tratados serviços extras descobertos durante a preparação."
    ],
    "question": "O pintor pode garantir que termina antes da minha mudança?",
    "answer": "Apresente a data desejada, mas confirme a viabilidade após a avaliação. Preparação da superfície, secagem e acesso ao imóvel influenciam o prazo. Registre as etapas e combine como serão comunicados possíveis ajustes."
  },
  "limpeza-de-sofa/sao-bernardo-do-campo": {
    "lead": "Manchas, odores ou sujeira no sofá em São Bernardo do Campo? Informe tecido, tamanho e condições de acesso para avaliar o método e planejar a secagem após a limpeza.",
    "heading": "Tecido, peças e secagem: confira antes de agendar",
    "scenarios": [
      "Sofá retrátil ou reclinável: informe quantidade de módulos, lugares e se as almofadas são removíveis.",
      "Manchas e odores: descreva a origem, quando apareceram e se algum produto já foi aplicado.",
      "Mais de uma peça: liste cadeiras, poltronas ou colchões separadamente para evitar diferença de escopo entre propostas."
    ],
    "example": "Quero limpar um sofá em São Bernardo do Campo, bairro [bairro], com [lugares/módulos], tecido [tipo ou não sei]. Há [manchas/odor] desde [quando]. Já usei [produto ou nenhum]. Preciso saber método, previsão de secagem e valor total para [dia].",
    "checklist": [
      "Procure a etiqueta do fabricante e informe o material; se não souber, peça avaliação.",
      "Pergunte sobre água, energia e espaço necessários, além dos cuidados de ventilação e uso após a limpeza.",
      "Combine o que está incluído e alinhe expectativas: remoção total de manchas e prazo exato de secagem não devem ser presumidos."
    ],
    "question": "Posso usar o sofá no mesmo dia da limpeza?",
    "answer": "Depende do tecido, do método e das condições de secagem. Pergunte ao profissional quando poderá usar o estofado e como ventilar o ambiente. Informe se você precisa do sofá em uma data específica antes de agendar."
  }
};
const ampliados = require('./seo-montagem-sofa.cjs');
Object.assign(services, ampliados.services);
pages.push(...ampliados.pages);
Object.assign(editoriais, ampliados.editoriais);
const novasProfissoes = require('./seo-mais-profissoes.cjs');
Object.assign(services, novasProfissoes.services);
pages.push(...novasProfissoes.pages);
Object.assign(editoriais, novasProfissoes.editoriais);
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const css=`*{box-sizing:border-box}body{margin:0;background:#f3f5f9;color:#0b1d3a;font:16px/1.65 system-ui,-apple-system,sans-serif}a{color:#174f91}a:focus-visible{outline:3px solid #e0630f;outline-offset:4px}header,main,footer{max-width:1040px;margin:auto;padding:22px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}header a{text-decoration:none;color:inherit}header .brand{display:flex;gap:10px;align-items:center;font-size:21px;font-weight:800}header img{width:40px;height:40px}.hero{background:#0b1d3a;color:#fff;border-radius:24px;padding:clamp(24px,5vw,48px)}.eyebrow{color:#ffb47f;font-size:14px;font-weight:700}h1{font-size:clamp(30px,5vw,48px);line-height:1.15;max-width:740px;margin:16px 0}h2{font-size:24px;line-height:1.3;margin:0 0 14px}p{margin:12px 0}.hero p{max-width:730px;color:#dce5f4}.cta{display:inline-flex;justify-content:center;align-items:center;min-height:52px;padding:13px 22px;border-radius:12px;background:#b94c08;color:white;text-decoration:none;font-weight:750;line-height:1.4;margin:14px 0}.hero .cta{background:#ffad73;color:#241002}.note{font-size:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0}.card{background:#fff;border:1px solid #e2e6ee;border-radius:20px;padding:28px}.card li{margin:10px 0}ol,ul{padding-left:22px}.full{margin:20px 0}details{border-bottom:1px solid #e2e6ee;padding:16px 0}summary{font-weight:700;cursor:pointer}footer{font-size:14px;color:#53647a}blockquote{margin:16px 0;padding:16px 20px;border-left:4px solid #e0630f;background:#f3f5f9;border-radius:0 12px 12px 0;overflow-wrap:anywhere}.links{display:flex;flex-wrap:wrap;gap:10px 20px}.end{background:#e7ecf5}.crumb{font-size:14px;margin:0 0 18px}@media(max-width:650px){header,main,footer{padding:16px}.grid{grid-template-columns:1fr}.card{padding:22px}.cta{width:100%}header>a:last-child{font-size:14px}}`;
for(const [slug,citySlug,city] of pages){
 const s=services[slug], route='/servicos/'+slug+'/'+citySlug+'/', url='https://quemfazservico.com.br'+route;
 const editorial=editoriais[slug+'/'+citySlug];
 const modified=editorial.modified || '2026-10-16';
 const modifiedLabel=modified.split('-').reverse().join('/');
 const title=s.name+' em '+city+' | Peça orçamento grátis | Quem Faz';
 const description=editorial.lead;
 const query=new URLSearchParams({servico:s.category,seo_page:route});
 const cta='/?'+query.toString()+'#/auth/cliente/cadastro';
 const button='<a class="cta" data-request href="'+esc(cta)+'">Pedir orçamento grátis</a>';
 const schema={'@context':'https://schema.org','@type':'WebPage',name:title,url,description,dateModified:modified,isPartOf:{'@type':'WebSite',name:'Quem Faz',url:'https://quemfazservico.com.br/'}};
 const related=pages.filter(p=>p[0]!==slug||p[1]!==citySlug).sort((a,b)=>(Number(b[1]===citySlug)*2+Number(b[0]===slug))-(Number(a[1]===citySlug)*2+Number(a[0]===slug))).slice(0,8).map(p=>'<a href="/servicos/'+p[0]+'/'+p[1]+'/">'+esc(services[p[0]].name+' em '+p[2])+'</a>').join('');
 const script=`document.querySelectorAll('[data-request]').forEach(function(a){a.addEventListener('click',function(){try{sessionStorage.setItem('qf_pending_category',${JSON.stringify(s.category)});sessionStorage.setItem('qf_client_search_region',JSON.stringify({cidade:${JSON.stringify(city)},uf:'SP'}));sessionStorage.removeItem('qf_repeat_order_draft');}catch(e){}});});`;
 const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${url}"><link rel="icon" href="/favicon.png"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${url}"><script type="application/ld+json">${JSON.stringify(schema)}</script><style>${css}</style></head><body><header><a class="brand" href="/"><img src="/icon.svg" alt="">Quem Faz</a><a href="/servicos/">Ver outros serviços</a></header><main><nav class="crumb" aria-label="Localização"><a href="/">Início</a> / <a href="/servicos/">Serviços</a> / ${esc(s.name)} em ${esc(city)}</nav><section class="hero"><div class="eyebrow">${esc(city)} · SP</div><h1>${esc(s.name)} em ${esc(city)}</h1><p>${esc(editorial.lead)}</p>${button}<p class="note">Publicar o pedido é grátis, e até 4 profissionais podem entrar em contato. O serviço é pago diretamente ao profissional, conforme o combinado.</p></section><div class="grid"><section class="card"><h2>Seu pedido em poucos passos</h2><ol><li>Abra o formulário com o serviço e a cidade preenchidos.</li><li>Informe seu bairro, o que precisa e quando deseja o atendimento.</li><li>Publique, compare os contatos recebidos e escolha com quem negociar.</li></ol><p class="note">Os contatos dependem da disponibilidade de profissionais na região.</p></section><section class="card"><h2>O que informar no pedido</h2><ul>${s.items.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul><p>Inclua o bairro em ${esc(city)} e informações sobre acesso ao imóvel, como regras de condomínio.</p></section></div><section class="card full" aria-labelledby="situacoes"><h2 id="situacoes">${esc(editorial.heading)}</h2><ul>${editorial.scenarios.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></section><section class="card full" aria-labelledby="exemplo"><h2 id="exemplo">Exemplo de pedido para ${esc(city)}</h2><p class="note">Modelo ilustrativo: substitua os campos entre colchetes pelos detalhes do seu serviço.</p><blockquote>${esc(editorial.example)}</blockquote>${button}</section><section class="card full"><h2>Antes de confirmar a visita</h2><ul>${editorial.checklist.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul></section><section class="card full"><h2>Como comparar os orçamentos</h2><p>${esc(s.compare)}</p><p>Compare o mesmo escopo entre as propostas. Combine o valor total, a data e as condições de pagamento antes de fechar.</p></section><section class="card full"><h2>Dúvidas antes de contratar</h2><details><summary>Quanto custa ${esc(s.name.toLowerCase())} em ${esc(city)}?</summary><p>O preço varia conforme tamanho, condições e tarefas necessárias. Informe os detalhes para receber uma proposta adequada. Publicar no Quem Faz é gratuito; o valor do serviço é negociado com o profissional.</p></details><details><summary>${esc(editorial.question)}</summary><p>${esc(editorial.answer)}</p></details><details><summary>${esc(s.question)}</summary><p>${esc(s.answer)}</p></details><details><summary>Posso pedir para hoje?</summary><p>Informe o prazo desejado no formulário. O atendimento depende da agenda do profissional; confirme a disponibilidade diretamente antes de combinar.</p></details><details><summary>Preciso contratar quem entrar em contato?</summary><p>Você compara as propostas e escolhe se deseja contratar. Confirme o que está incluído antes de fechar o serviço.</p></details></section><section class="card full end"><h2>Vamos resolver seu serviço?</h2><p>Conte o que precisa em ${esc(city)}. O formulário já começa com ${esc(s.name.toLowerCase())} selecionado.</p>${button}</section><section class="card full"><h2>Outras buscas no Quem Faz</h2><div class="links">${related}</div></section></main><footer>Conteúdo revisado em <time datetime="${modified}">${modifiedLabel}</time>. Orientações para descrever e comparar serviços; a disponibilidade é confirmada com o profissional.<br>Quem Faz · Conectando clientes e profissionais. <a href="/">Página inicial</a></footer><script>${script}</script></body></html>`;
 const folder=path.join(__dirname,'..','dist',route);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'index.html'),html);
}
console.log('Conteúdo revisado: '+pages.length+' páginas locais com acesso direto ao pedido.');

// Indexar somente os novos conteúdos editoriais, mantendo páginas genéricas em noindex.
const dist = path.join(__dirname, '..', 'dist');
const mapFile = path.join(dist, 'sitemap.xml');
let sitemap = fs.readFileSync(mapFile, 'utf8');
for (const [slug, citySlug] of novasProfissoes.pages) {
 const url = 'https://quemfazservico.com.br/servicos/' + slug + '/' + citySlug + '/';
 if (!sitemap.includes('<loc>' + url + '</loc>')) sitemap = sitemap.replace('</urlset>', '  <url><loc>' + url + '</loc><lastmod>2026-10-20</lastmod></url>\n</urlset>');
}
fs.writeFileSync(mapFile, sitemap);
for (const [slug, citySlug, city] of novasProfissoes.pages) {
 const hubFile = path.join(dist, 'servicos', slug, 'index.html');
 let hub = fs.readFileSync(hubFile, 'utf8');
 if (!hub.includes('data-qf-novas-profissoes')) {
  const link = '<a href="/servicos/' + slug + '/' + citySlug + '/">' + esc(services[slug].name + ' em ' + city) + '</a>';
  hub = hub.replace('</main>', '<section data-qf-novas-profissoes><h2>Guia para contratar</h2><p>' + link + ': veja o que informar no pedido e como comparar propostas. A disponibilidade depende dos profissionais que atendem sua região.</p></section></main>');
  fs.writeFileSync(hubFile, hub);
 }
}
