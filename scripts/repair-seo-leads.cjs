// SEO pós-build: aprimora páginas locais sem alterar a aplicação de pedidos.
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','dist');
const generator=fs.readFileSync(path.join(__dirname,'generate-seo-pages.cjs'),'utf8');
const match=generator.match(/const services=(\[[^\n]+\]);\s*const cities=/);
if(!match)throw Error('Mapa de serviços SEO não encontrado');
const categories=Object.fromEntries(JSON.parse(match[1]).map(s=>[s.slug,s.id]));
Object.assign(categories,{
 'limpeza-de-sofa':'cat_limpeza_estofados','higienizacao-de-sofa':'cat_limpeza_estofados',
 'lavagem-de-tapetes':'cat_limpeza_estofados','limpeza-de-colchas':'cat_limpeza_estofados',
 'limpeza-de-estofado':'cat_limpeza_estofados','limpeza-pos-obra':'cat_faxina_pos_obra',
 'tecnico-em-automacao':'cat_automacao_residencial','faxineira':'cat_diarista'
});
const guides={
 eletricista:['O que explicar ao eletricista','Informe se precisa instalar tomadas, trocar disjuntores, corrigir quedas de energia ou revisar a fiação. Diga quantos pontos precisam de atendimento.','Confirme materiais, diagnóstico, mão de obra e testes de segurança incluídos no orçamento.'],
 encanador:['Detalhes que ajudam no orçamento','Descreva vazamento, registro, descarga, torneira ou entupimento. Informe a localização da tubulação e a necessidade de acessar paredes ou pisos.','Compare peças, deslocamento, possíveis reparos no revestimento e testes do conserto.'],
 diarista:['Como descrever a limpeza','Informe cômodos, banheiros, tamanho aproximado, frequência e tarefas extras como janelas, armários ou passar roupas.','Combine tarefas, duração, produtos, deslocamento e valor total.'],
 pintor:['Como pedir um orçamento de pintura','Informe ambientes, metragem aproximada, estado das paredes, teto, portas e áreas externas. Fotos dos locais ajudam a esclarecer o serviço.','Compare preparação, correção de imperfeições, demãos de tinta, materiais e proteção dos móveis.'],
 'montador-de-moveis':['Como solicitar montagem','Diga qual móvel precisa montar, marca, modelo, quantidade e se está novo ou desmontado. Fotos das peças e instruções ajudam.','Confira ferramentas, fixação na parede, acabamento e recolhimento das embalagens.'],
 chaveiro:['Informações para o chaveiro','Indique abertura de porta, troca de fechadura, chave perdida ou reparo. Descreva o tipo de porta e a urgência.','Confirme visita, peças, horário e valor final antes de autorizar.'],
 'marido-de-aluguel':['Liste os pequenos reparos','Descreva quantidades de prateleiras, suportes, torneiras ou portas que precisam de ajuste. Informe os tipos de parede.','Confira quais ferramentas, materiais e tarefas estão incluídos.'],
 'tecnico-de-geladeira':['Descreva o defeito da geladeira','Informe marca, modelo e sintomas como falta de refrigeração, ruídos, vazamento de água ou código de erro.','Pergunte sobre diagnóstico, peças, prazo e garantia do reparo.'],
 'faxina-pos-obra':['Detalhes da limpeza pós-obra','Informe tamanho do imóvel, tipo de obra, poeira, manchas e resíduos. Indique vidros e pisos delicados.','Confirme etapas, materiais, descarte e prazo de limpeza.'],
 'azulejista-pisos':['Como solicitar assentamento de piso','Informe metragem, tipo e tamanho das peças, condição do contrapiso e retirada de piso antigo.','Combine nivelamento, rejunte, perdas de material, acabamento e limpeza.'],
 'ar-condicionado':['Como pedir instalação ou reparo','Informe capacidade em BTUs, marca, modelo e sintomas; para instalação, descreva onde ficam as unidades.','Confira materiais, suporte, drenagem, adequação elétrica e testes.'],
 desentupidor:['Como descrever o entupimento','Informe se ocorre na pia, vaso, ralo ou tubulação externa e se a água retorna ou transborda.','Confirme técnica, avaliação inicial, deslocamento e cobranças extras.']
};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const duplicated=new Set(['pintor','diarista','tecnico-em-informatica']);
const redundant=new Set();
let ctas=0,helpful=0,canonicalCount=0;
function visit(dir){
 for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,e.name);
  if(e.isDirectory()){visit(file);continue}
  if(e.name!=='index.html'||file===path.join(root,'index.html'))continue;
  const bits=path.relative(root,file).split(path.sep).slice(0,-1);
  const inServicos=bits[0]==='servicos',slug=bits[inServicos?1:0];
  if(!categories[slug])continue;
  let html=fs.readFileSync(file,'utf8');
  html=html.replace(/até 3/gi,m=>m[0]==='A'?'Até 4':'até 4');
  if(!inServicos&&duplicated.has(slug)){
   const suffix=bits.join('/')+'/';
   html=html.replace(/<link rel="canonical" href="[^"]+">/,'<link rel="canonical" href="https://quemfazservico.com.br/servicos/'+suffix+'">');
   redundant.add('https://quemfazservico.com.br/'+suffix);
   canonicalCount++;
  }
  const editorial=html.includes('data-request');
  if(!editorial&&inServicos&&guides[slug]){
   const [title,details,check]=guides[slug];
   const section='<section aria-label="Orientações para contratar"><h2>'+esc(title)+'</h2><p>'+esc(details)+'</p><h2>O que conferir na proposta</h2><p>'+esc(check)+'</p></section>';
   html=html.replace('</main>',section+'</main>');helpful++;
  }
  let original=null;
  if(!editorial)html=html.replace(/<a([^>]*?) href="(\/\?servico=[^"]+)"([^>]*)>/g,(all,before,href,after)=>{
   if(!original)original=new URL(href,'https://quemfazservico.com.br');
   ctas++;
   return '<a'+before+' href="'+(href.includes('#')?href:href+'#/auth/cliente/cadastro')+'" data-qf-seo-cta'+after+'>';
  });
  if(original){
   const city=original.searchParams.get('cidade')||'';
   const uf=original.searchParams.get('uf')||(city?'SP':'');
   const init='sessionStorage.setItem("qf_pending_category",'+JSON.stringify(categories[slug])+');'+
     (city?'sessionStorage.setItem("qf_client_search_region",JSON.stringify({cidade:'+JSON.stringify(city)+',uf:'+JSON.stringify(uf)+'}));':'sessionStorage.removeItem("qf_client_search_region");');
   const script='<script>(function(){document.addEventListener("click",function(e){var a=e.target.closest("a[data-qf-seo-cta]");if(!a)return;try{'+init+'sessionStorage.removeItem("qf_repeat_order_draft");}catch(err){}},true)})();</script>';
   html=html.replace('</body>',script+'</body>');
  }
  fs.writeFileSync(file,html);
 }
}
visit(path.join(root,'servicos'));
for(const e of fs.readdirSync(root,{withFileTypes:true})){
 if(e.isDirectory()&&e.name!=='servicos'&&categories[e.name])visit(path.join(root,e.name));
}
const mapFile=path.join(root,'sitemap.xml');
let sitemap=fs.readFileSync(mapFile,'utf8');
for(const url of redundant)sitemap=sitemap.split('<url><loc>'+url+'</loc></url>').join('');
fs.writeFileSync(mapFile,sitemap);
if(ctas<700||helpful<80||canonicalCount<20)throw Error('SEO: verificação falhou: '+ctas+' links, '+helpful+' guias, '+canonicalCount+' canônicas');
console.log('SEO: '+ctas+' botões levam ao formulário, '+helpful+' páginas enriquecidas e '+canonicalCount+' duplicações consolidadas.');
