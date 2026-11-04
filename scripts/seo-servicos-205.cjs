// Cobertura editorial baseada apenas em categorias e cidades realmente cadastradas.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),out=path.join(root,'dist');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const source=fs.readFileSync(path.join(__dirname,'generate-seo-pages.cjs'),'utf8');
const services=JSON.parse(source.match(/const services=(\[[^\n]+\]);/)[1]);
const aliases={'diadema-sp':'Diadema','sao-caetano':'São Caetano do Sul','saopaulo':'São Paulo','rio-grande-da-serra':'Rio Grande da Serra'};
const excluded=new Set(['alphaville','diadema-jabaquara-sao-paulo-abcd','sao-pauloq']);
const cities=new Map();
for(const row of require('../data/seo-coverage-205.json').cidades){
 if(excluded.has(slug(row.cidade)))continue;
 const nome=aliases[slug(row.cidade)]||row.cidade;
 const key=slug(nome)+'-'+row.uf.toLowerCase();
 const current=cities.get(key)||{nome,uf:row.uf,slug:slug(nome),ids:new Set()};
 row.especialidades.forEach(id=>current.ids.add(id));cities.set(key,current);
}
// Use a grafia oficial do catálogo quando há variantes de caixa/acentuação.
for(const c of cities.values())if(c.slug==='santo-andre')c.nome='Santo André';else if(c.slug==='mogi-das-cruzes')c.nome='Mogi das Cruzes';else if(c.slug==='sao-paulo')c.nome='São Paulo';
const covered=[...cities.values()].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'));
const home=fs.readFileSync(path.join(out,'index.html'),'utf8');
const assets=[...home.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]).filter(url=>/^(?:\/?app-main-|\/?vendor\/supabase|\/?qf-(?:atendimento|visita|cliente-acesso|acompanhamento|client-acquisition|conversao|city-cep-resolver)\.js)/.test(url));
const styles=[...home.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(m=>m[1]).filter(x=>x.startsWith('app-style-'));
const connection=[...home.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].find(m=>!m[1].includes('src=')&&m[2].includes('QF_CONNECTION_V11_14_47'))?.[0];
if(!connection)throw Error('Conexão existente não encontrada');
const appAssets=connection+styles.map(x=>'<link rel="stylesheet" href="/'+x+'">').join('')+assets.map(x=>'<script defer src="/'+x.replace(/^\//,'')+'"></script>').join('');
const base='https://quemfazservico.com.br';
const links=(list)=>'<ul class="seo-links">'+list.map(([url,label])=>'<li><a href="'+url+'">'+esc(label)+'</a></li>').join('')+'</ul>';
const urlFor=(s,c)=>'/servicos/'+s.slug+'/'+(c?c.slug+'/':'');
const generated=[];
function write(url,title,desc,content,service,city,index=true){
 const dir=path.join(out,url);fs.mkdirSync(dir,{recursive:true});
 const schema={'@context':'https://schema.org','@graph':[{'@type':'WebPage','name':title,'description':desc,'url':base+url,'isPartOf':{'@type':'WebSite','name':'Quem Faz Serviços','url':base}},{'@type':'BreadcrumbList','itemListElement':[{ '@type':'ListItem',position:1,name:'Serviços',item:base+'/servicos/'},...(service?[{'@type':'ListItem',position:2,name:service.nome,item:base+urlFor(service)}]:[]),...(city?[{'@type':'ListItem',position:3,name:city.nome+' / '+city.uf,item:base+url}]:[])]}]};
 const config=service?'<script id="seo-config" type="application/json">'+JSON.stringify({id:service.id,service:service.nome,city:city?.nome||'',uf:city?.uf||''}).replace(/</g,'\\u003c')+'</script>':'';
 const form=service?'<section class="seo-form" id="pedido" aria-label="Solicitar '+esc(service.nome)+'"><h2>Conte o que você precisa</h2><p>Publicar é grátis. Os valores e a disponibilidade são combinados com o profissional.</p><div id="seo-order"><p role="status">Preparando formulário…</p></div><noscript>Ative o JavaScript para preencher seu pedido. <a href="/">Abrir Quem Faz</a></noscript></section>':'';
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'"><meta name="robots" content="'+(index?'index':'noindex')+',follow"><link rel="canonical" href="'+base+url+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(desc)+'"><meta property="og:url" content="'+base+url+'"><meta property="og:type" content="website"><link rel="icon" href="/icon.svg"><script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,'\\u003c')+'</script>'+(service?appAssets:'')+'<link rel="stylesheet" href="/qf-seo-servicos.css"></head><body class="seo-page"><header class="seo-header"><a href="/"><img src="/assets/qf-logo-branco-20261014.webp" width="180" height="60" alt="Quem Faz Serviços"></a><a href="/#/cliente/pedidos">Meus pedidos</a></header><main class="seo-main"><nav aria-label="Caminho"><a href="/">Início</a> / <a href="/servicos/">Serviços</a>'+(service?' / <a href="'+urlFor(service)+'">'+esc(service.nome)+'</a>':'')+'</nav><div class="seo-hero"><div><p class="seo-eyebrow">QUEM FAZ • SERVIÇOS NA SUA REGIÃO</p><h1>'+esc(title.replace(' | Quem Faz',''))+'</h1><p class="seo-lead">'+esc(desc)+'</p><p>Explique o serviço, confirme o CEP e publique. Acompanhe o pedido e converse com os profissionais pelo Quem Faz.</p>'+(service?'<a class="seo-cta" href="#pedido">Solicitar serviço grátis</a>':'')+'</div>'+form+'</div><article class="seo-content">'+content+'</article></main><footer class="seo-footer"><a href="/privacidade/">Privacidade</a> · Quem Faz Serviços</footer>'+(service?'<div id="app-shell" hidden><main id="app-content"></main></div>'+config+'<script defer src="/qf-seo-servicos.js"></script>':'')+'</body></html>';
 fs.writeFileSync(path.join(dir,'index.html'),html);generated.push({url,index,city:city?.nome,uf:city?.uf,service:service?.nome});
}
for(const s of services){
 const local=covered.filter(c=>c.ids.has(s.id));
 const detail=fs.readFileSync(path.join(out,'servicos',s.slug,'index.html'),'utf8').match(/<meta name="description" content="([^"]+)"/)?.[1]||'';
 const guide='<p>'+esc(detail)+'</p><h2>Como preparar seu pedido de '+esc(s.nome)+'</h2><p>Descreva o problema, o tipo de local e o que espera resolver. Se houver equipamentos ou materiais envolvidos, informe modelo, quantidade e condições de acesso. Esses detalhes ajudam o profissional a avaliar o trabalho antes de combinar o orçamento.</p><h2>Como funciona</h2><ol><li>Preencha o formulário nesta página.</li><li>Confirme o local pelo CEP e escolha o prazo.</li><li>Revise seus dados e autorize o contato.</li><li>Acompanhe o pedido e combine o atendimento.</li></ol><h2>Quanto custa?</h2><p>A publicação do pedido é gratuita. O preço do serviço depende do trabalho e deve ser combinado antes da contratação. Não há garantia de resposta imediata.</p>';
 write(urlFor(s),s.nome+' | Quem Faz','Precisa de '+s.nome.toLowerCase()+'? Publique seu pedido grátis e consulte as regiões com profissionais cadastrados.',guide+'<h2>Regiões com cadastro nesta profissão</h2>'+(local.length?links(local.map(c=>[urlFor(s,c),c.nome+' / '+c.uf])):'<p>A cobertura desta profissão ainda não está confirmada nesta atualização. A disponibilidade será verificada para o local informado.</p>'),s,null,!!local.length);
 // Páginas locais repetitivas são navegáveis, mas ficam fora do índice até terem conteúdo editorial local próprio.
 for(const c of local){const others=services.filter(x=>c.ids.has(x.id)&&x.id!==s.id);write(urlFor(s,c),s.nome+' em '+c.nome+' / '+c.uf+' | Quem Faz','Solicite '+s.nome.toLowerCase()+' em '+c.nome+' / '+c.uf+'. Descreva o serviço e publique seu pedido grátis no Quem Faz.', '<h2>'+esc(s.nome)+' em '+esc(c.nome)+'</h2><p>Há cadastro de profissional com esta especialidade e região de atendimento em '+esc(c.nome)+' / '+c.uf+' na consulta de 04/11/2026. Isso não representa disponibilidade imediata: o atendimento depende do endereço, do raio e da agenda de cada profissional. O CEP informado no pedido determina o local real do serviço.</p>'+guide+'<h2>Outros serviços com cobertura cadastrada em '+esc(c.nome)+'</h2>'+links(others.map(x=>[urlFor(x,c),x.nome]))+'<h2>Outras regiões para '+esc(s.nome)+'</h2>'+links(local.filter(x=>x!==c).map(x=>[urlFor(s,x),x.nome+' / '+x.uf])),s,c,false);}
}
// Atualiza também combinações antigas sem cobertura confirmada, preservando a URL.
function preserve(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())preserve(p);else if(e.name==='index.html'){
 const url='/'+path.relative(out,path.dirname(p)).split(path.sep).join('/')+'/';
 if(generated.some(x=>x.url===url))continue;
 const parts=url.split('/').filter(Boolean),s=services.find(x=>x.slug===parts[1]);
 if(!s)continue;
 write(url,s.nome+' — consulte sua região | Quem Faz','Descreva seu serviço de '+s.nome.toLowerCase()+' e consulte a disponibilidade para o CEP informado.','<h2>Consulte a disponibilidade</h2><p>A cobertura desta combinação de serviço e região não está confirmada nesta consulta. Informe o CEP real no formulário. A publicação não garante a disponibilidade de um profissional.</p><h2>Regiões confirmadas para esta profissão</h2>'+links(covered.filter(c=>c.ids.has(s.id)).map(c=>[urlFor(s,c),c.nome+' / '+c.uf])),s,null,false);
}}}
preserve(path.join(out,'servicos'));
write('/servicos/','Encontre serviços na sua região | Quem Faz','Escolha o serviço e publique seu pedido grátis. Consulte a cobertura cadastrada por profissão e região.', '<h2>Qual serviço você precisa?</h2>'+links(services.map(s=>[urlFor(s),s.nome]))+'<h2>Regiões cadastradas</h2>'+links(covered.map(c=>['#regiao-'+c.slug,c.nome+' / '+c.uf]))+covered.map(c=>'<section id="regiao-'+c.slug+'"><h3>'+esc(c.nome)+' / '+c.uf+'</h3>'+links(services.filter(s=>c.ids.has(s.id)).map(s=>[urlFor(s,c),s.nome]))+'</section>').join(''));
// Preserve arquivos e URLs anteriores sem afirmar cobertura para combinações inexistentes.
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name==='index.html'){let h=fs.readFileSync(p,'utf8');h=h.replace(/<script data-qf-direct-organic>[\s\S]*?<\/script>/g,'').replace(/<noscript><meta http-equiv="refresh"[^>]*><\/noscript>/g,'');fs.writeFileSync(p,h);}}}
walk(path.join(out,'servicos'));
let sitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8').replace(/<url>\s*<loc>https:\/\/quemfazservico\.com\.br\/servicos\/[\s\S]*?<\/url>/g,'');
sitemap=sitemap.replace('</urlset>',generated.filter(x=>x.index).map(x=>'<url><loc>'+base+x.url+'</loc></url>').join('\n')+'\n</urlset>');fs.writeFileSync(path.join(out,'sitemap.xml'),sitemap);
fs.writeFileSync(path.join(out,'seo-205-manifest.json'),JSON.stringify({date:'2026-11-04',regions:covered.map(c=>({cidade:c.nome,uf:c.uf})),pages:generated},null,2));
console.log('Issue 205: '+covered.length+' regiões, '+generated.length+' páginas com formulário e navegação; locais genéricas noindex.');
