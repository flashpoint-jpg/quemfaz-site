// SEO editorial para dez URLs existentes. Não modifica o fluxo de pedido nem a navegação.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist','servicos');
const base='https://quemfazservico.com.br/servicos/';
const pages=[
  {
    "slug": "eletricista/santo-andre",
    "title": "Eletricista em Santo André para reparos e instalações | Quem Faz",
    "description": "Precisa de eletricista em Santo André? Explique problemas em tomadas, chuveiro ou disjuntor e publique seu pedido grátis.",
    "h1": "Como explicar uma falha elétrica?",
    "p1": "Informe se a falha afeta um cômodo ou todo o imóvel, qual aparelho estava em uso e quando começou. Não toque em fiação exposta nem tente reparar circuitos energizados.",
    "h2": "O que considerar no orçamento elétrico?",
    "p2": "Confirme se há cobrança por visita ou diagnóstico, quais materiais estão incluídos e as condições de garantia."
  },
  {
    "slug": "eletricista/diadema",
    "title": "Eletricista em Diadema para reparos e instalações | Quem Faz",
    "description": "Tomada com defeito ou disjuntor desarmando em Diadema? Descreva o serviço e consulte profissionais pelo CEP.",
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
