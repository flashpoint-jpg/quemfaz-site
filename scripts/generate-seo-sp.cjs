const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const domain='https://quemfazservico.com.br';
const cities=[['São Paulo','sao-paulo'],['Santo André','santo-andre'],['São Bernardo do Campo','sao-bernardo-do-campo'],['Mauá','maua'],['Diadema','diadema'],['Ribeirão Pires','ribeirao-pires'],['Rio Grande da Serra','rio-grande-da-serra'],['Guarulhos','guarulhos'],['Suzano','suzano'],['Bauru','bauru'],['Ribeirão Preto','ribeirao-preto']];
const services=[
['limpeza-de-sofa','Limpeza de sofá','Informe o número de lugares, o tecido, se é retrátil e quais manchas ou odores deseja tratar.','Confirme a compatibilidade do método com o tecido, o que está incluído e o prazo estimado de secagem.'],
['higienizacao-de-sofa','Higienização de sofá','Explique o tipo de estofado, frequência de uso e se há manchas, odores ou necessidades especiais de limpeza.','Pergunte sobre produtos, equipamentos, ventilação necessária e cuidados recomendados após o serviço.'],
['lavagem-de-tapetes','Lavagem de tapetes','Informe medidas aproximadas, material, quantidade de peças e se há manchas ou odores.','Confirme se a lavagem é feita no local ou com retirada, prazo de entrega e cuidados para o material.'],
['limpeza-de-colchas','Limpeza de colchas','Informe quantidade, dimensões, composição do tecido e se há etiquetas com instruções de lavagem.','Confira se o método é adequado ao enchimento, prazo de entrega e condições de coleta.'],
['limpeza-de-estofado','Limpeza de estofado','Diga se precisa limpar poltronas, cadeiras, colchões ou outros estofados, indicando material e quantidade.','Pergunte sobre tratamento de manchas, proteção do tecido, preço por peça e secagem.'],
['limpeza-pos-obra','Limpeza pós-obra','Descreva a metragem, o tipo de reforma, a quantidade de resíduos e os ambientes que precisam de limpeza.','Confirme quais etapas estão incluídas, materiais utilizados, descarte de resíduos e prazo de execução.'],
['tecnico-em-automacao','Técnico em automação','Explique se precisa instalar, configurar ou reparar dispositivos, sensores, controles ou sistemas automatizados.','Informe marcas, modelos, sintomas e verifique compatibilidade, testes e garantia do serviço.'],
['tecnico-em-informatica','Técnico em informática','Descreva o equipamento, o sistema operacional e o problema apresentado, como lentidão, falha de rede ou inicialização.','Confirme diagnóstico, orçamento antes do reparo, política de backup e proteção dos seus dados.'],
['diarista','Diarista','Informe o tamanho do imóvel, número de cômodos, tarefas esperadas e materiais disponíveis.','Combine duração, frequência, tarefas incluídas, acesso ao local e valor total antes do atendimento.'],
['faxineira','Faxineira','Descreva os ambientes, o nível de limpeza desejado e se precisa de vidros, cozinha, banheiros ou áreas externas.','Confirme produtos necessários, duração prevista, atividades incluídas e disponibilidade.'],
['pintor','Pintor','Informe metragem aproximada, ambientes, estado das paredes e se é pintura interna, externa ou de acabamento.','Combine preparação de superfície, massa e lixamento, quantidade de demãos, materiais e proteção dos móveis.']
];
const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
let xml=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
let added=0;
for(const [slug,name,brief,check] of services){
  const base=path.join(root,slug,'index.html');
  if(fs.existsSync(base)){
    let html=fs.readFileSync(base,'utf8');
    const marker='<!-- local-service-navigation -->';
    if(!html.includes(marker)){
      const section=marker+'<section class="panel"><h2>'+esc(name)+' em São Paulo e região</h2><p>Escolha sua cidade e informe o bairro no pedido. A disponibilidade depende dos profissionais ativos na região.</p><ul>'+cities.map(([city,citySlug])=>'<li><a href="/'+slug+'/'+citySlug+'/">'+esc(name)+' em '+esc(city)+'</a></li>').join('')+'</ul></section>';
      html=html.replace('</main>',section+'</main>');
      fs.writeFileSync(base,html);
    }
  }
  for(const [city,citySlug] of cities){
    const url=domain+'/'+slug+'/'+citySlug+'/';
    const folder=path.join(root,slug,citySlug);fs.mkdirSync(folder,{recursive:true});
    const desc=name+' em '+city+', SP: descreva o serviço, informe seu bairro e encontre profissionais pelo Quem Faz.';
    const query='/?servico='+encodeURIComponent(name)+'&cidade='+encodeURIComponent(city)+'&uf=SP';
    const schema=JSON.stringify({'@context':'https://schema.org','@type':'Service',name:name+' em '+city,serviceType:name,url,areaServed:{'@type':'City',name:city},provider:{'@type':'Organization',name:'Quem Faz',url:domain}});
    const nearby=cities.filter(x=>x[1]!==citySlug).map(x=>'<li><a href="/'+slug+'/'+x[1]+'/">'+esc(name)+' em '+esc(x[0])+'</a></li>').join('');
    const related=services.filter(x=>x[0]!==slug).slice(0,5).map(x=>'<li><a href="/'+x[0]+'/'+citySlug+'/">'+esc(x[1])+' em '+esc(city)+'</a></li>').join('');
    const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(name)+' em '+esc(city)+' | Quem Faz</title><meta name="description" content="'+esc(desc)+'"><meta name="robots" content="index,follow"><link rel="canonical" href="'+url+'"><link rel="icon" href="/icon.svg" type="image/svg+xml"><script type="application/ld+json">'+schema+'</'+'script><style>*{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#102345;font:17px/1.65 system-ui,Arial,sans-serif}header,main,footer{max-width:900px;margin:auto;padding:20px}header{font-size:24px;font-weight:800;background:white}header span{color:#dc6617}.panel{background:white;border:1px solid #e7edf4;border-radius:18px;padding:clamp(20px,5vw,38px);margin:20px 0}h1{font-size:clamp(30px,5vw,44px);line-height:1.15}h2{font-size:23px;margin-top:24px}.cta{display:inline-block;background:#dc6617;color:white;text-decoration:none;padding:15px 24px;border-radius:12px;font-weight:750;margin:12px 0}a{color:#17518a}li{margin:8px 0}footer{font-size:14px;color:#53647a}</style></head><body><header><a href="/" style="color:inherit;text-decoration:none">Quem<span>Faz</span></a></header><main><section class="panel"><h1>'+esc(name)+' em '+esc(city)+'</h1><p>Precisa de '+esc(name.toLowerCase())+' em '+esc(city)+'? Descreva sua necessidade e informe o bairro. O Quem Faz ajuda a conectar seu pedido a profissionais que atendem a região, conforme disponibilidade.</p><a class="cta" href="'+query+'">Receber até 3 orçamentos grátis</a></section><section class="panel"><h2>O que informar ao solicitar o serviço</h2><p>'+esc(brief)+'</p><h2>O que verificar antes de contratar</h2><p>'+esc(check)+'</p><h2>Como encontrar atendimento em '+esc(city)+'</h2><ol><li>Escolha o serviço e informe seu bairro em '+esc(city)+'.</li><li>Explique o que precisa e quando deseja o atendimento.</li><li>Publique gratuitamente o pedido.</li><li>Compare os contatos recebidos e negocie com o profissional.</li></ol><h2>Valores e disponibilidade</h2><p>O preço depende do escopo, das condições do serviço e do deslocamento. Informe os detalhes no pedido e confirme valores e prazos diretamente com cada profissional. Não há garantia de atendimento imediato.</p><h2>Perguntas frequentes</h2><h3>Posso solicitar atendimento no meu bairro?</h3><p>Sim. Informe seu bairro em '+esc(city)+' no formulário para que o pedido tenha uma localização mais precisa.</p><h3>Como recebo os orçamentos?</h3><p>Publique o pedido gratuitamente e acompanhe os contatos de profissionais interessados, conforme a disponibilidade na sua região.</p><a class="cta" href="'+query+'">Pedir orçamento grátis</a><p><a href="/'+slug+'/">Saiba mais sobre '+esc(name.toLowerCase())+'</a></p></section><section class="panel"><h2>Outros serviços em '+esc(city)+'</h2><ul>'+related+'</ul><h2>Outras cidades atendidas</h2><ul>'+nearby+'</ul></section></main><footer>Quem Faz — encontre profissionais na sua região. <a href="/">Página inicial</a></footer></body></html>';
    fs.writeFileSync(path.join(folder,'index.html'),html);
    if(!xml.includes('<loc>'+url+'</loc>')){xml=xml.replace('</urlset>','  <url><loc>'+url+'</loc></url>\n</urlset>');added++;}
  }
}
fs.writeFileSync(path.join(root,'sitemap.xml'),xml);
console.log('SEO São Paulo: '+(services.length*cities.length)+' páginas locais geradas; '+added+' novas URLs no sitemap.');
