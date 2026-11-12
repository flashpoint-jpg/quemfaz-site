// Links editoriais de descoberta para buscas locais prioritárias, sem criar URLs artificiais.
// Gerador anterior já definiu cobertura e indexabilidade a partir dos cadastros.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','dist');
const hub=path.join(root,'servicos','index.html');
let html=fs.readFileSync(hub,'utf8');
// Priorizado após consulta de profissionais por cidade/especialidade em 09/11/2026.
// A checagem abaixo impede destacar páginas noindex ou ausentes.
const candidates=[
 ['pintor/sao-paulo','Pintor em São Paulo'],
 ['eletricista/sao-paulo','Eletricista em São Paulo'],
 ['encanador/sao-paulo','Encanador em São Paulo'],
 ['eletricista/sao-bernardo-do-campo','Eletricista em São Bernardo do Campo'],
 ['encanador/sao-bernardo-do-campo','Encanador em São Bernardo do Campo'],
 ['montador-de-moveis/sao-bernardo-do-campo','Montador de móveis em São Bernardo do Campo'],
 ['pintor/guarulhos','Pintor em Guarulhos'],
 ['eletricista/guarulhos','Eletricista em Guarulhos'],
 ['eletricista/santo-andre','Eletricista em Santo André'],
 ['eletricista/diadema','Eletricista em Diadema'],
 ['encanador/santo-andre','Encanador em Santo André'],
 ['diarista/guarulhos','Diarista em Guarulhos'],
 ['eletricista/praia-grande','Eletricista em Praia Grande'],
 ['pintor/praia-grande','Pintor em Praia Grande']
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
