// Links editoriais de descoberta para buscas locais prioritárias, sem criar URLs artificiais.
// Gerador anterior já definiu cobertura e indexabilidade a partir dos cadastros.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','dist');
const hub=path.join(root,'servicos','index.html');
let html=fs.readFileSync(hub,'utf8');
const candidates=[
 ['eletricista/muzambinho','Eletricista em Muzambinho'],
 ['eletricista/guarulhos','Eletricista em Guarulhos'],
 ['diarista/guarulhos','Diarista em Guarulhos'],
 ['eletricista/santo-andre','Eletricista em Santo André'],
 ['eletricista/diadema','Eletricista em Diadema'],
 ['limpeza-de-sofa/santo-andre','Limpeza de sofá em Santo André']
];
const links=candidates.filter(([slug])=>{
 const f=path.join(root,'servicos',slug,'index.html');
 return fs.existsSync(f)&&/<meta name="robots" content="index,follow">/.test(fs.readFileSync(f,'utf8'));
}).map(([slug,label])=>'<li><a href="/servicos/'+slug+'/">'+label+'</a></li>');
if(links.length<3)throw Error('Poucas páginas locais indexáveis: '+links.length);
const marker='<article class="seo-content">';
if(!html.includes(marker))throw Error('Hub de serviços sem estrutura esperada');
if(!html.includes('data-qf-discovery-20261109')){
 html=html.replace(marker,marker+'<section data-qf-discovery-20261109 aria-label="Serviços em destaque"><h2>Encontre profissionais na sua cidade</h2><p>Escolha a profissão e a cidade para consultar a cobertura cadastrada. Informe seu CEP no pedido para verificar atendimento na sua região.</p><ul class="seo-links">'+links.join('')+'</ul></section>');
 fs.writeFileSync(hub,html);
}
console.log('SEO: '+links.length+' links locais prioritários no catálogo.');
