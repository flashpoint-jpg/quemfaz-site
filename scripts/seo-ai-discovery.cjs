// Captura a origem antes do formulário e preserva a primeira página de entrada.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const tag='<script src="/qf-ai-origin.js?v=20261123-1"></script>';
function add(file){
  let html=fs.readFileSync(file,'utf8');
  if(!html.includes(tag)) fs.writeFileSync(file,html.replace(/<head(?:\s[^>]*)?>/i,m=>m+tag));
}
function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(file);
    else if(entry.name==='index.html') add(file);
  }
}
add(path.join(root,'index.html'));
walk(path.join(root,'servicos'));

// Conteúdo editorial para buscas de contratação, apenas em páginas canônicas com cobertura.
const manifest=JSON.parse(fs.readFileSync(path.join(root,'seo-205-manifest.json'),'utf8'));
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const base='https://quemfazservico.com.br';
const topics={
 'eletricista/santo-andre':['Preciso de um eletricista para revisar o quadro de energia. Como pedir?','Informe se o disjuntor desarma com um aparelho específico ou em vários cômodos. Peça diagnóstico antes de autorizar a troca de componentes e não manuseie o quadro energizado.'],
 'encanador/santo-andre':['Como contratar um encanador para um vazamento sem saber a origem?','Informe onde surge a umidade, se o hidrômetro gira com torneiras fechadas e se há acesso ao registro. Combine o custo do diagnóstico e eventual reparo antes de iniciar.'],
 'montador-de-moveis/santo-andre':['Comprei um guarda-roupa novo. O que combinar com o montador?','Informe o número de portas, se o móvel está embalado, o andar do imóvel e o espaço para montagem. Confirme se a proposta inclui fixação na parede e ajuste de portas.'],
 'encanador/sao-bernardo-do-campo':['Preciso trocar uma descarga ou reparar um vazamento. Como comparar propostas?','Explique se a descarga é de caixa acoplada ou válvula de parede. Peça que separem mão de obra, peças e eventual visita técnica.'],
 'limpeza-de-sofa/sao-bernardo-do-campo':['Posso pedir higienização de sofá retrátil?','Informe número de lugares, tecido, manchas e se o sofá tem partes reclináveis. Combine a técnica adequada ao material e quando poderá voltar a utilizar o estofado.'],
 'diarista/guarulhos':['Como encontrar uma diarista para limpar um apartamento?','Indique quantos quartos e banheiros há, se o imóvel está ocupado e se precisa de limpeza de vidros ou cozinha. Combine materiais, duração e tarefas antes de contratar.'],
 'pintor/maua':['Como pedir orçamento para pintar uma casa?','Informe a quantidade de ambientes, metragem aproximada e se há umidade, descascamento ou reparos. Confirme se a proposta inclui preparação, tinta e proteção dos móveis.'],
 'eletricista/osasco':['Onde solicitar um eletricista em Osasco para tomadas e iluminação?','Informe o bairro e quantos pontos precisam de reparo ou instalação, se há falha recorrente e se o imóvel é residencial ou comercial. Compare propostas pelo mesmo escopo.'],
 'encanador/osasco':['Como encontrar um encanador em Osasco para reparos hidráulicos?','Informe se o problema está na pia, descarga, torneira ou tubulação. Se for condomínio, combine acesso e eventual necessidade de fechar o registro com a administração.'],
 'eletricista/suzano':['Como solicitar uma instalação elétrica em Suzano?','Descreva o equipamento ou ponto de iluminação, o local e a instalação existente. Confirme se a proposta inclui materiais e testes após o serviço. Não intervenha em fiação energizada.'],
 'pedreiro/suzano':['Onde pedir orçamento de pedreiro em Suzano para uma pequena reforma?','Informe as medidas aproximadas, se há demolição, alvenaria ou acabamento, quem fornece materiais e como será retirado o entulho. Peça avaliação profissional para intervenções estruturais.']
};
const esc=v=>String(v).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let enriched=0;
for(const page of manifest.pages){
 if(!page.index||!page.city||!page.service)continue;
 const key=page.url.replace(/^\/servicos\//,'').replace(/\/$/,'');
 if(!topics[key])continue;
 if(!sitemap.includes('<loc>'+base+page.url+'</loc>'))throw Error('GEO: rota não indexável '+page.url);
 const file=path.join(root,page.url,'index.html');
 let html=fs.readFileSync(file,'utf8');
 if(!html.includes('id="seo-order"')||!html.includes('</article>'))throw Error('GEO: formulário ou artigo ausente '+page.url);
 const [question,answer]=topics[key];
 const section='<section class="seo-practical" data-qf-ai-editorial><h2>'+esc(question)+'</h2><p>'+esc(answer)+'</p><p>O Quem Faz é uma plataforma que conecta clientes e profissionais. Para solicitar propostas em '+esc(page.city)+', confirme o CEP e descreva o trabalho. A disponibilidade e os valores dependem de cada profissional. <a href="#pedido">Solicitar orçamento</a>.</p></section>';
 html=html.replace('</article>',section+'</article>');
 const schema={'@context':'https://schema.org','@type':'Service','name':page.service+' em '+page.city,'url':base+page.url,'serviceType':page.service,'areaServed':{'@type':'City','name':page.city,'containedInPlace':{'@type':'State','name':page.uf}},'provider':{'@type':'Organization','name':'Quem Faz Serviços','url':base},'description':'Plataforma de solicitação de propostas de profissionais; atendimento sujeito à cobertura, agenda e raio.'};
 // A plataforma intermedeia a solicitação; não declarar execução direta, avaliações ou preço fictício.
 delete schema.provider;
 schema.broker={'@type':'Organization','name':'Quem Faz Serviços','url':base};
 html=html.replace('</head>','<script type="application/ld+json" data-qf-ai-schema>'+JSON.stringify(schema).replace(/</g,'\\u003c')+'</script></head>');
 fs.writeFileSync(file,html);enriched++;
}
console.log('GEO: '+enriched+' páginas canônicas enriquecidas com perguntas úteis e dados estruturados.');
