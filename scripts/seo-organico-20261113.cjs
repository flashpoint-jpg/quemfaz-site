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
console.log('SEO orgânico: '+entries.length+' páginas locais reforçadas após a geração.');
