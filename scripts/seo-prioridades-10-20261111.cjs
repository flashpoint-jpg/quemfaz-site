// SEO editorial para dez URLs existentes. Não modifica o fluxo de pedido nem a navegação.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist','servicos');
const base='https://quemfazservico.com.br/servicos/';
const pages=[
  {
    "slug": "eletricista/santo-andre",
    "title": "Eletricista em Santo André | Peça orçamento grátis no Quem Faz",
    "description": "Precisa instalar um chuveiro, trocar tomadas ou avaliar um disjuntor em Santo André? Publique seu pedido grátis e receba propostas conforme a disponibilidade.",
    "h1": "Como explicar uma falha elétrica?",
    "p1": "Informe se a falha afeta um cômodo ou todo o imóvel, qual aparelho estava em uso e quando começou. Não toque em fiação exposta nem tente reparar circuitos energizados.",
    "h2": "O que considerar no orçamento elétrico?",
    "p2": "Confirme se há cobrança por visita ou diagnóstico, quais materiais estão incluídos e as condições de garantia."
  },
  {
    "slug": "eletricista/diadema",
    "title": "Eletricista em Diadema | Peça orçamento grátis no Quem Faz",
    "description": "Tomada com defeito ou disjuntor desarmando em Diadema? Informe seu CEP, descreva o serviço e publique seu pedido de orçamento grátis.",
    "h1": "Quando procurar eletricista em Diadema?",
    "p1": "Queda de energia em parte do imóvel, tomada aquecendo ou disjuntor desarmando exigem avaliação adequada. Informe o tipo de imóvel e a extensão da falha.",
    "h2": "O que perguntar antes do serviço?",
    "p2": "Verifique custos da avaliação, materiais, testes de segurança e prazo. Não faça intervenções elétricas por conta própria."
  },
  {
    "slug": "encanador/sao-bernardo-do-campo",
    "title": "Encanador em São Bernardo para vazamentos | Quem Faz",
    "description": "Precisa de encanador em São Bernardo do Campo? Descreva vazamentos, registros ou tubulações e peça orçamento grátis.",
    "h1": "O que informar sobre um vazamento?",
    "p1": "Explique se aparece em parede, piso, torneira ou descarga, quando surgiu e se o registro pode ser fechado sem risco.",
    "h2": "Como comparar reparos hidráulicos?",
    "p2": "Pergunte sobre taxa de diagnóstico, necessidade de quebrar parede, reposição de revestimento e peças incluídas."
  },
  {
    "slug": "diarista/santo-andre",
    "title": "Diarista em Santo André para faxina | Quem Faz",
    "description": "Procura diarista em Santo André? Informe cômodos, tipo de faxina, bairro e dia desejado para solicitar propostas.",
    "h1": "Que tipo de faxina você precisa?",
    "p1": "Diferencie limpeza de rotina, faxina detalhada e limpeza antes de mudança. Informe quantidade de banheiros e cômodos, escadas e animais no imóvel.",
    "h2": "O que combinar antes da diária?",
    "p2": "Defina tarefas, duração esperada, produtos de limpeza, deslocamento e valor total."
  },
  {
    "slug": "pintor/maua",
    "title": "Pintor em Mauá para casas e apartamentos | Quem Faz",
    "description": "Precisa pintar sua casa em Mauá? Informe cômodos, estado das paredes e prazo para publicar um pedido grátis.",
    "h1": "Como preparar um pedido de pintura?",
    "p1": "Informe metragem aproximada, quantidade de ambientes, manchas, descascamento e móveis que precisam de proteção.",
    "h2": "O que comparar no orçamento de pintura?",
    "p2": "Confira preparação, massa, número de demãos, tinta fornecida, limpeza e prazo. Infiltrações devem ser avaliadas antes."
  },
  {
    "slug": "encanador/santo-andre",
    "title": "Encanador em Santo André para vazamentos | Quem Faz",
    "description": "Precisa de encanador em Santo André? Informe vazamentos, registros e reparos hidráulicos. Publique seu pedido grátis.",
    "h1": "Como detalhar vazamentos em Santo André?",
    "p1": "Informe se o vazamento está em parede, torneira, descarga ou piso, se é contínuo e se há sinais de umidade.",
    "h2": "O que incluir no orçamento hidráulico?",
    "p2": "Confirme custos de diagnóstico, peças, necessidade de abertura e recomposição de parede e prazo de atendimento."
  },
  {
    "slug": "eletricista/sao-bernardo-do-campo",
    "title": "Eletricista em São Bernardo para reparos | Quem Faz",
    "description": "Precisa de eletricista em São Bernardo do Campo? Descreva falhas em tomadas, chuveiros e iluminação e publique grátis.",
    "h1": "O que informar sobre a instalação elétrica?",
    "p1": "Explique quais pontos apresentam falha, se o imóvel é casa ou apartamento e quando o problema começou. Evite manusear circuitos com defeito.",
    "h2": "Como avaliar propostas de eletricista?",
    "p2": "Esclareça visita de diagnóstico, materiais, mão de obra, testes e garantia antes de contratar."
  },
  {
    "slug": "eletricista/guarulhos",
    "title": "Eletricista em Guarulhos para instalações | Quem Faz",
    "description": "Precisa de eletricista em Guarulhos? Descreva a instalação ou falha elétrica e consulte atendimento pelo CEP.",
    "h1": "Como descrever um reparo elétrico?",
    "p1": "Indique se precisa instalar luminária, chuveiro, tomada ou corrigir falta de energia. Informe o ambiente e acesso ao quadro, sem mexer na instalação.",
    "h2": "O que conferir na proposta?",
    "p2": "Peça separação de materiais, mão de obra e diagnóstico e esclareça condições de garantia e prazo."
  },
  {
    "slug": "montador-de-moveis/sao-bernardo-do-campo",
    "title": "Montador de móveis em São Bernardo | Quem Faz",
    "description": "Precisa montar guarda-roupa, painel ou cômoda em São Bernardo? Descreva o móvel e peça orçamento gratuitamente.",
    "h1": "Como solicitar montagem de móveis?",
    "p1": "Informe marca e modelo, quantidade de portas ou gavetas, existência de manual e ferragens, e se é montagem ou remontagem.",
    "h2": "Quais serviços podem ser cobrados à parte?",
    "p2": "Pergunte sobre desmontagem, fixação em parede, deslocamento, transporte e peças ausentes."
  },
  {
    "slug": "pintor/guarulhos",
    "title": "Pintor em Guarulhos para pintura residencial | Quem Faz",
    "description": "Precisa de pintor em Guarulhos? Informe ambientes, metragem aproximada e prazo. Publique seu pedido gratuitamente.",
    "h1": "O que descrever na pintura?",
    "p1": "Informe se são paredes internas, tetos, portas ou fachada, estado do reboco e área aproximada.",
    "h2": "Como comparar propostas de pintores?",
    "p2": "Esclareça quem compra tintas, tratamento de superfícies, número de demãos, limpeza final e cronograma."
  },
  {
    "slug": "diarista/guarulhos",
    "title": "Diarista em Guarulhos para faxina | Quem Faz",
    "description": "Procura diarista em Guarulhos? Informe o bairro, os cômodos e a data da faxina. Publique seu pedido de orçamento grátis.",
    "h1": "Como pedir uma diária em Guarulhos?",
    "p1": "Informe o bairro ou CEP e diga se o imóvel está ocupado, vazio para mudança ou passou por obra. Em condomínio, confirme o horário de entrada e informe se há escadas ou elevador.",
    "h2": "O que comparar no preço da faxina?",
    "p2": "Peça o valor total por visita e confirme a duração, o deslocamento e os produtos incluídos. Se precisar de janelas, armários por dentro ou roupa passada, combine esses itens antes de fechar."
  },
  {
    "slug": "limpeza-de-estofados-e-tapetes/sao-paulo",
    "title": "Limpeza de sofá em São Paulo | Orçamento grátis no Quem Faz",
    "description": "Sofá manchado ou com cheiro? Informe o tecido, o número de lugares e o CEP para pedir orçamento grátis.",
    "h1": "O que informar sobre o sofá?",
    "p1": "Diga se o sofá é fixo, retrátil ou reclinável. Descreva o tecido e o tipo de mancha, e informe se há elevador ou escadas para o acesso ao imóvel.",
    "h2": "O que conferir antes da limpeza?",
    "p2": "Pergunte se o orçamento inclui almofadas soltas, remoção de manchas e deslocamento. Combine o prazo de secagem e informe se há crianças ou animais no imóvel."
  },
  {
    "slug": "faxina-pos-obra/sao-paulo",
    "title": "Faxina pós-obra em São Paulo | Orçamento grátis no Quem Faz",
    "description": "Terminou a reforma? Informe a metragem e os resíduos que precisam ser removidos para pedir orçamento grátis.",
    "h1": "O que informar depois da obra?",
    "p1": "Descreva a área, o tipo de piso e os resíduos que ficaram, como pó fino, tinta ou rejunte. Informe se ainda há entulho ou móveis no imóvel.",
    "h2": "Como comparar os orçamentos?",
    "p2": "Confira se incluem vidros, armários e áreas externas, quais equipamentos serão levados e se há cobrança separada para retirada de resíduos."
  },
  {
    "slug": "montador-de-moveis/osasco",
    "title": "Montador de móveis em Osasco | Orçamento grátis no Quem Faz",
    "description": "Peça orçamento grátis para montar guarda-roupa, cômoda ou painel em Osasco. Informe o modelo do móvel e o CEP.",
    "h1": "O que informar para montar um móvel?",
    "p1": "Diga quantos móveis são e informe marca e modelo quando souber. Se for remontagem, avise se as ferragens e o manual estão disponíveis.",
    "h2": "O que combinar antes da visita?",
    "p2": "Confirme se o orçamento inclui fixação do painel, desmontagem de peças antigas e o deslocamento até o endereço do serviço."
  },
  {
    "slug": "pedreiro/guarulhos",
    "title": "Pedreiro em Guarulhos | Orçamento grátis no Quem Faz",
    "description": "Precisa de pedreiro para reparo ou reforma em Guarulhos? Informe a área e descreva o serviço para pedir orçamento grátis.",
    "h1": "Como descrever o reparo?",
    "p1": "Explique o local e a extensão do trabalho. Informe se é assentamento de piso, reparo de reboco ou levantamento de parede.",
    "h2": "O que pedir no orçamento?",
    "p2": "Peça a lista de etapas e confirme quem fornece os materiais, protege o ambiente e retira o entulho."
  },
  {
    "slug": "pedreiro/sao-bernardo-do-campo",
    "title": "Pedreiro em São Bernardo do Campo | Orçamento grátis no Quem Faz",
    "description": "Peça orçamento grátis para alvenaria, reboco ou assentamento de piso em São Bernardo do Campo.",
    "h1": "Como informar a área do serviço?",
    "p1": "Informe metragem aproximada, material existente e se o imóvel estará ocupado durante o trabalho.",
    "h2": "Como comparar propostas?",
    "p2": "Confira se a preparação da superfície, o acabamento e a retirada de resíduos fazem parte da proposta e quais dias estão disponíveis."
  },
  {
    "slug": "pintor/osasco",
    "title": "Pintor em Osasco | Orçamento grátis no Quem Faz",
    "description": "Informe os cômodos e o estado das paredes para pedir orçamento grátis de pintura em Osasco.",
    "h1": "Como descrever o ambiente?",
    "p1": "Informe o número de ambientes, o estado das paredes, a cor atual e se precisa pintar portas ou tetos.",
    "h2": "O que comparar entre propostas?",
    "p2": "Confira a preparação das superfícies, a proteção de móveis e pisos, o número de demãos e quem fornece tinta e materiais."
  },
  {
    "slug": "encanador/guarulhos",
    "title": "Encanador em Guarulhos | Orçamento grátis no Quem Faz",
    "description": "Precisa reparar vazamento, trocar torneira ou consertar a descarga em Guarulhos? Peça orçamento grátis.",
    "h1": "Como explicar o problema hidráulico?",
    "p1": "Diga se o problema está na pia, no vaso, no registro ou em uma parede. Informe há quanto tempo ocorre e se acontece apenas quando usa a água.",
    "h2": "O que conferir no orçamento?",
    "p2": "Confirme se a proposta separa visita, diagnóstico, peças e reparo. Se for preciso abrir piso ou parede, pergunte se o acabamento está incluído."
  },
  {
    "slug": "diarista/sao-bernardo-do-campo",
    "title": "Diarista em São Bernardo do Campo | Orçamento grátis no Quem Faz",
    "description": "Peça orçamento grátis para faxina em São Bernardo do Campo. Informe os cômodos e a data desejada.",
    "h1": "O que colocar no pedido de faxina?",
    "p1": "Diga quantos cômodos e banheiros serão limpos, se o imóvel está ocupado e se há animais ou escadas.",
    "h2": "O que combinar para a diária?",
    "p2": "Confirme as tarefas da diária, quem fornece os produtos e se itens como forno, janelas e armários entram no valor."
  }
];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sitemap=fs.readFileSync(path.join(root,'..','sitemap.xml'),'utf8');
for(const p of pages){
  const file=path.join(root,p.slug,'index.html');
  if(!fs.existsSync(file)) throw new Error('SEO prioritário: página ausente '+p.slug);
  let html=fs.readFileSync(file,'utf8');
  const canonical=base+p.slug+'/';
  if(!sitemap.includes('<loc>'+canonical+'</loc>')) throw new Error('SEO prioritário: página fora do sitemap '+p.slug);
  if(!html.includes('rel="canonical" href="'+canonical+'"')) throw new Error('SEO prioritário: canonical divergente '+p.slug);
  if(!/<meta\s+name="robots"\s+content="index,follow"/.test(html)) throw new Error('SEO prioritário: página não indexável '+p.slug);
  if(!html.includes('id="seo-order"')||!html.includes('id="seo-config"')||!html.includes('href="#pedido"')) throw new Error('SEO prioritário: formulário ausente '+p.slug);
  if(!html.includes('<article class="seo-content">')) throw new Error('SEO prioritário: conteúdo ausente '+p.slug);
  if(html.includes('data-qf-seo-10="20261111"')) throw new Error('SEO prioritário duplicado '+p.slug);
  html=html.replace(/<title>[^<]*<\/title>/,'<title>'+esc(p.title)+'</title>');
  html=html.replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="'+esc(p.description)+'">');
  html=html.replace(/<meta property="og:title" content="[^"]*">/,'<meta property="og:title" content="'+esc(p.title)+'">');
  html=html.replace(/<meta property="og:description" content="[^"]*">/,'<meta property="og:description" content="'+esc(p.description)+'">');
  const schemaMatch=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if(!schemaMatch) throw new Error('SEO prioritário: schema ausente '+p.slug);
  const schema=JSON.parse(schemaMatch[1]);
  const graph=Array.isArray(schema['@graph'])?schema['@graph']:[schema];
  const webPage=graph.find(x=>x['@type']==='WebPage');
  if(!webPage)throw new Error('SEO prioritário: WebPage ausente '+p.slug);
  webPage.name=p.title;webPage.description=p.description;
  html=html.replace(schemaMatch[0],'<script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,'\\u003c')+'</script>');
  const section='<section class="seo-practical" data-qf-seo-10="20261111"><h2>'+esc(p.h1)+'</h2><p>'+esc(p.p1)+'</p><h2>'+esc(p.h2)+'</h2><p>'+esc(p.p2)+'</p><p>Informe o CEP e os detalhes no formulário desta página. Publicar é gratuito, e as propostas dependem de profissionais disponíveis na região.</p></section>';
  html=html.replace('</article>',section+'</article>');
  if(!html.includes(section)||!html.includes('id="seo-order"'))throw new Error('SEO prioritário: falha na atualização '+p.slug);
  fs.writeFileSync(file,html);
}
console.log('SEO prioritário: '+pages.length+' páginas melhoradas com formulário e URLs preservados.');
