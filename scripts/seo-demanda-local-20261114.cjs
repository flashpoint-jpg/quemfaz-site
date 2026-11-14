// Complementos para consultas que já geram impressões orgânicas (GSC, 15/10–11/11/2026).
// Nunca cria páginas ou remove noindex: só reforça URLs canônicas já indexáveis.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const origin='https://quemfazservico.com.br';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const entries=[
  {
    slug:'eletricista/diadema',
    title:'Eletricista em Diadema: como explicar um reparo urgente?',
    text:'Descreva se o problema é no chuveiro, tomada, iluminação ou disjuntor; informe o bairro, desde quando acontece e se há falta de energia em outros ambientes. Se notar cheiro de queimado ou fios expostos, mantenha distância e não tente fazer reparos.',
    related:['eletricista/santo-andre','encanador/sao-bernardo-do-campo']
  },
  {
    slug:'limpeza-de-sofa/santo-andre',
    title:'Limpeza de sofá em Santo André: quais detalhes ajudam no orçamento?',
    text:'Informe quantos lugares o sofá possui, se é retrátil ou tem chaise, o tecido quando souber, as manchas ou odores e o bairro. Pergunte sobre secagem e deslocamento antes de comparar as propostas.',
    related:['limpeza-de-sofa/sao-bernardo-do-campo','diarista/santo-andre']
  },
  {
    slug:'limpeza-de-sofa/sao-bernardo-do-campo',
    title:'Higienização de sofá em São Bernardo: o que combinar?',
    text:'Conte se o sofá tem almofadas removíveis, manchas antigas ou contato com animais. Confirme com o profissional o método de limpeza indicado para o tecido, o prazo de secagem e o preço total para a peça.',
    related:['limpeza-de-sofa/santo-andre','encanador/sao-bernardo-do-campo']
  },
  {
    slug:'montador-de-moveis/santo-andre',
    title:'Montador de móveis em Santo André: prepare seu pedido',
    text:'Informe o tipo e a quantidade de móveis, medidas aproximadas, marca ou modelo e se a montagem é nova ou uma desmontagem para mudança. Verifique ferragens, manual e espaço disponível antes da visita.',
    related:['montador-de-moveis/sao-bernardo-do-campo','diarista/santo-andre']
  },
  {
    slug:'encanador/sao-bernardo-do-campo',
    title:'Encanador em São Bernardo: vazamento ou instalação?',
    text:'Diga se o serviço é em pia, banheiro, descarga ou tubulação e se o vazamento acontece continuamente. Confirme no orçamento o diagnóstico, as peças, a mão de obra e eventuais reparos no revestimento.',
    related:['eletricista/santo-andre','limpeza-de-sofa/sao-bernardo-do-campo']
  },
  {
    slug:'pintor/maua',
    title:'Pintor em Mauá: como pedir propostas comparáveis?',
    text:'Informe se a pintura é interna ou externa, a quantidade de cômodos, o estado das paredes e se há umidade ou descascamento. Peça que cada proposta esclareça preparação, materiais, demãos e prazo.',
    related:['montador-de-moveis/santo-andre','diarista/santo-andre']
  }
];
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const canonical=slug=>origin+'/servicos/'+slug+'/';
const pageFor=slug=>path.join(root,'servicos',slug,'index.html');
function indexable(slug){
  const file=pageFor(slug);
  if(!fs.existsSync(file)||!sitemap.includes('<loc>'+canonical(slug)+'</loc>'))return false;
  const html=fs.readFileSync(file,'utf8');
  return html.includes('<meta name="robots" content="index,follow">')&&html.includes('rel="canonical" href="'+canonical(slug)+'"');
}
let updated=0;
for(const item of entries){
  if(!indexable(item.slug))continue;
  const file=pageFor(item.slug);
  let html=fs.readFileSync(file,'utf8');
  if(html.includes('data-qf-demanda-20261114'))throw Error('Seção de demanda duplicada: '+item.slug);
  if(!html.includes('</article>')||!html.includes('id="seo-order"'))throw Error('Página sem artigo ou formulário: '+item.slug);
  const related=item.related.filter(indexable).map(slug=>'<li><a href="/servicos/'+slug+'/">'+esc(slug.replaceAll('/',' em ').replaceAll('-',' '))+'</a></li>');
  const city=item.slug.split('/')[1];
  const cityLink='/servicos/cidades/'+city+'/';
  const citySection=indexable('cidades/'+city)?'<p><a href="'+cityLink+'">Conheça outros serviços nesta cidade</a>.</p>':'';
  const section='<section class="seo-practical" data-qf-demanda-20261114><h2>'+esc(item.title)+'</h2><p>'+esc(item.text)+'</p><p>Informe o CEP do serviço e o prazo no pedido gratuito. A disponibilidade depende da região e da agenda de cada profissional.</p>'+(related.length?'<h3>Serviços relacionados na região</h3><ul>'+related.join('')+'</ul>':'')+citySection+'</section>';
  html=html.replace('</article>',section+'</article>');
  fs.writeFileSync(file,html);
  updated++;
}
if(updated<4)throw Error('Poucas páginas prioritárias indexáveis: '+updated);
console.log('SEO demanda local: '+updated+' páginas reforçadas sem alterar formulários.');
