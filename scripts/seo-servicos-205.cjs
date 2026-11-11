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
// O rastreamento passa a ser gerenciado somente por qf-conversao.js, com validação do domínio.
const googleTracking='';
if(!assets.some(url=>/qf-conversao\.js/.test(url)))throw Error('Módulo de conversão do Google Ads não encontrado');
const consent='<script>try{window.QFConsentInicial=JSON.parse(localStorage.getItem("qf_consent_v1")||"null")?.medicao||"granted";}catch(_){window.QFConsentInicial="granted";}</script>';
const appAssets=consent+googleTracking+connection+styles.map(x=>'<link rel="stylesheet" href="/'+x+'">').join('')+assets.map(x=>'<script defer src="/'+x.replace(/^\//,'')+'"></script>').join('');
const base='https://quemfazservico.com.br';
const links=(list)=>'<ul class="seo-links">'+list.map(([url,label])=>'<li><a href="'+url+'">'+esc(label)+'</a></li>').join('')+'</ul>';
const urlFor=(s,c)=>'/servicos/'+s.slug+'/'+(c?c.slug+'/':'');
// Preserve os guias editoriais já indexáveis antes de atualizar o catálogo.
const editorial=[];const previousSitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8');
for(const match of previousSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)){
 const u=new URL(match[1]);if(!u.pathname.startsWith('/servicos/')||u.pathname.split('/').filter(Boolean).length<3)continue;
 const f=path.join(out,u.pathname,'index.html');if(!fs.existsSync(f))continue;
 const h=fs.readFileSync(f,'utf8');const parts=u.pathname.split('/').filter(Boolean);const service=services.find(s=>s.slug===parts[1]||(parts[1]==='limpeza-de-sofa'&&s.id==='cat_limpeza_estofados'));if(!service)continue;
 if(parts[2]!=='abc'&&!covered.some(c=>c.slug===parts[2]&&c.ids.has(service.id)))continue;
 const content=h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];if(!content)continue;
 editorial.push({url:u.pathname,service,title:h.match(/<title>([^<]+)<\/title>/)?.[1]||service.nome+' | Quem Faz',description:h.match(/<meta name="description" content="([^"]+)"/)?.[1]||'Publique seu pedido grátis no Quem Faz.',content:content.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<noscript>[\s\S]*?<\/noscript>/gi,'').replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/i,'').replace(/href="\/\?[^"]*"/g,'href="#pedido"')});
}
const generated=[];
function write(url,title,desc,content,service,city,index=true){
 const dir=path.join(out,url);fs.mkdirSync(dir,{recursive:true});
 const schema={'@context':'https://schema.org','@graph':[{'@type':'WebPage','name':title,'description':desc,'url':base+url,'isPartOf':{'@type':'WebSite','name':'Quem Faz Serviços','url':base}},{'@type':'BreadcrumbList','itemListElement':[{ '@type':'ListItem',position:1,name:'Serviços',item:base+'/servicos/'},...(service?[{'@type':'ListItem',position:2,name:service.nome,item:base+urlFor(service)}]:[]),...(city?[{'@type':'ListItem',position:3,name:city.nome+' / '+city.uf,item:base+url}]:[])]}]};
 const config=service?'<script id="seo-config" type="application/json">'+JSON.stringify({id:service.id,service:service.nome,placeholder:'Ex.: '+(require('../qf-atendimento.js').questions({servico:service.nome}).find(q=>q.key==='detalhes')?.choices?.[0]?.[1]||'descreva o que precisa resolver'),city:city?.nome||'',uf:city?.uf||''}).replace(/</g,'\\u003c')+'</script>':'';
 const form=service?'<section class="seo-form" id="pedido" aria-label="Solicitar '+esc(service.nome)+'"><p class="seo-form-eyebrow">SEU PEDIDO COMEÇA AQUI</p><h2>Solicite seu orçamento grátis</h2><p class="seo-form-intro">Informe o CEP do local do serviço para consultar atendimento. Sem cadastro obrigatório.</p><div id="seo-order"><p role="status">Preparando formulário…</p></div><noscript>Ative o JavaScript para preencher seu pedido. <a href="/">Abrir Quem Faz</a></noscript></section>':'';
 const pilot=service?.id==='cat_eletricista'&&city?.slug==='santo-andre';
 const heading=pilot?service.nome+' em '+city.nome+', '+city.uf:
  service?('Precisa de '+service.nome.toLowerCase()+(city?' em '+city.nome:'')+'?'):title.replace(' | Quem Faz','');
 const examples=pilot?'<div class="seo-benefits" aria-label="Exemplos de serviços"><span>Instalações</span><span>Reparos</span><span>Tomadas e chuveiros</span></div>':'';
 const otherCity=service&&city?'<p>Precisa em outra cidade? <a href="'+urlFor(service)+'#pedido">Consultar pelo CEP em outra cidade</a>.</p>':'';
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><meta name="description" content="'+esc(desc)+'"><meta name="robots" content="'+(index?'index':'noindex')+',follow"><link rel="canonical" href="'+base+url+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(desc)+'"><meta property="og:url" content="'+base+url+'"><meta property="og:type" content="website"><link rel="icon" href="/icon.svg"><script type="application/ld+json">'+JSON.stringify(schema).replace(/</g,'\\u003c')+'</script>'+(service?appAssets:'')+'<link rel="stylesheet" href="/qf-seo-servicos.css"></head><body class="seo-page"><header class="seo-header"><div class="seo-header-inner"><a class="seo-brand" href="/"><img src="/assets/qf-logo-branco-20261014.webp" width="150" height="50" alt="Quem Faz Serviços"></a><nav class="seo-menu" aria-label="Menu do site"><a href="/servicos/">Serviços</a><a class="seo-menu-how" href="/">Como funciona</a><details class="seo-menu-prof"><summary>Para profissionais</summary><div class="seo-menu-pop"><a href="/#/auth/profissional/login">Entrar como profissional</a><a href="https://play.google.com/store/apps/details?id=br.app.quemfaz">Baixar o app<span class="seo-sr"> no Google Play</span></a></div></details><a class="seo-menu-orders" href="/#/cliente/pedidos">Meus pedidos</a></nav></div></header><main class="seo-main"><nav aria-label="Caminho"><a href="/">Início</a> / <a href="/servicos/">Serviços</a>'+(service?' / <a href="'+urlFor(service)+'">'+esc(service.nome)+'</a>':'')+(city?' / <a href="/servicos/cidades/'+city.slug+'/">'+esc(city.nome)+' / '+esc(city.uf)+'</a>':'')+'</nav><div class="seo-hero"><div><p class="seo-eyebrow">QUEM FAZ • SERVIÇOS NA SUA REGIÃO</p><p class="seo-brand-tagline">Conectando você ao profissional certo.</p><h1>'+esc(heading)+'</h1><p class="seo-lead">'+esc(service?'Conte o que você precisa e solicite até 4 orçamentos. Você escolhe com quem contratar.':desc)+'</p><div class="seo-benefits"><span>✓ Publicação gratuita</span><span>✓ Contato protegido</span><span>✓ Sem obrigação de contratar</span></div>'+(service?'<a class="seo-cta" href="#pedido">Pedir orçamento grátis <span aria-hidden="true">→</span></a>':'')+otherCity+examples+'</div>'+form+'</div><article class="seo-content">'+content+(city?'<section aria-label="Mais serviços na cidade"><h2>Outros serviços em '+esc(city.nome)+'</h2><p><a href="/servicos/cidades/'+city.slug+'/">Ver profissões cadastradas em '+esc(city.nome)+' / '+esc(city.uf)+'</a></p></section>':'')+'</article></main><footer class="seo-footer"><a href="/privacidade/">Privacidade</a> · Quem Faz Serviços</footer>'+(service?'<div id="app-shell" hidden><main id="app-content"></main></div>'+config+'<script defer src="/qf-seo-servicos.js"></script>':'')+'</body></html>';
 fs.writeFileSync(path.join(dir,'index.html'),html);generated.push({url,index,city:city?.nome,uf:city?.uf,service:service?.nome});
}
// Conteudo util por servico: detalhes que realmente ajudam o cliente a pedir e comparar orcamentos.
const practicalAdvice={
 cat_eletricista:{
  issue:'Disjuntor desarmando, tomada aquecendo ou iluminação falhando são motivos para pedir avaliação de um eletricista. Se houver cheiro de queimado ou faíscas, afaste-se do ponto, desligue a energia somente se for seguro e não tente reparar a instalação por conta própria.',
  details:'Informe se o problema ocorre em um único cômodo ou na casa toda, quando começou, se acontece ao ligar um aparelho e se é uma instalação nova ou um reparo. Em prédio, esclareça eventuais regras de acesso.',
  compare:'Pergunte se a visita de diagnóstico é cobrada, se o orçamento discrimina materiais e mão de obra e quais condições de garantia são oferecidas.'
 },
 cat_encanador:{
  issue:'Vazamento no registro, descarga que não para de correr, sifão pingando e umidade na parede são exemplos de pedidos para encanador. Vazamento intenso exige fechar o registro de água quando isso puder ser feito com segurança.',
  details:'Diga onde ocorre o vazamento, há quanto tempo, se é aparente ou embutido, e se o local é casa ou apartamento. Informe se há risco de atingir móveis ou rede elétrica.',
  compare:'Peça que o profissional esclareça custos de diagnóstico, peças, mão de obra e eventuais reparos de parede ou piso antes de autorizar o serviço.'
 },
 cat_diarista:{
  issue:'Limpeza de rotina, faxina mais detalhada e preparação do imóvel antes de mudança exigem tempos e materiais diferentes. Explique o tipo de faxina desejada para receber propostas comparáveis.',
  details:'Informe quantidade de cômodos e banheiros, metragem aproximada se souber, presença de animais, escadas e se há necessidade de limpar vidros, forno, armários ou áreas externas.',
  compare:'Combine duração, tarefas incluídas, materiais e equipamentos necessários, transporte e valor total antes da diária.'
 },
 cat_pintor:{
  issue:'Paredes descascando, pintura antes de mudança, manchas de umidade e fachadas desgastadas têm preparações diferentes. Problemas de infiltração devem ser avaliados antes de pintar.',
  details:'Diga quais ambientes serão pintados, medidas aproximadas, estado das paredes, necessidade de massa e se móveis precisam de proteção ou deslocamento.',
  compare:'Confira preparação da superfície, número de demãos, fornecimento de tintas e materiais, limpeza ao final e prazo previsto.'
 },
 cat_montador:{
  issue:'Guarda-roupas, cômodas, painéis e móveis comprados desmontados podem exigir diferentes ferramentas e tempo de montagem. Se o móvel já foi usado, informe se é remontagem.',
  details:'Informe marca e modelo quando souber, quantidade de peças, estado da embalagem, existência de manual e ferragens, andar do imóvel e necessidade de fixação na parede.',
  compare:'Confirme se desmontagem, fixação, deslocamento e eventual falta de peças entram no valor, além da data disponível.'
 },
 cat_limpeza_estofados:{
  issue:'Sofá com manchas, odores, pelos de animais ou sujeira acumulada pode precisar de métodos diferentes conforme tecido e instruções do fabricante. Não há garantia de remoção total das manchas.',
  details:'Informe quantidade de lugares, se é retrátil ou reclinável, tipo de tecido se souber, idade das manchas, odores e se pretende incluir poltronas, colchões ou cadeiras.',
  compare:'Pergunte o método e os produtos usados, adequação ao tecido, tempo estimado de secagem, preço por peça e possíveis custos de deslocamento.'
 }
};
function practicalSection(service){
 const a=practicalAdvice[service.id];
 if(!a)return '';
 return '<section class="seo-practical"><h2>Quando solicitar '+esc(service.nome.toLowerCase())+'?</h2><p>'+esc(a.issue)+'</p><h2>Quais detalhes ajudam no orçamento?</h2><p>'+esc(a.details)+'</p><h2>O que comparar antes de contratar?</h2><p>'+esc(a.compare)+'</p></section>';
}
// Alvos do Keyword Planner (Brasil, 09/11/2026): usados somente onde a cobertura foi confirmada.
// Evite alegar profissionais disponiveis, atendimento imediato ou ranking garantido.
const keywordTargetMeta={
 'eletricista/guarulhos':{
  title:'Eletricista em Guarulhos para reparos e instalações | Quem Faz',
  description:'Precisa de eletricista em Guarulhos? Descreva o problema com tomadas, iluminação ou disjuntores e publique seu pedido grátis.'
 },
 'encanador/santo-andre':{
  title:'Encanador em Santo André para vazamentos e reparos | Quem Faz',
  description:'Procurando encanador em Santo André? Informe vazamentos, registros ou descarga com defeito e solicite orçamentos sem pagar para publicar.'
 },
 'montador-de-moveis/guarulhos':{
  title:'Montador de móveis em Guarulhos | Quem Faz Serviços',
  description:'Precisa montar guarda-roupa, cômoda ou painel em Guarulhos? Informe o modelo, bairro e prazo. Publique seu pedido grátis.'
 },
 'marido-de-aluguel/santo-andre':{
  title:'Marido de aluguel em Santo André | Quem Faz',
  description:'Precisa de pequenos reparos e instalações em Santo André? Descreva seu serviço e publique um pedido grátis no Quem Faz.'
 },
 'diarista/santo-andre':{
  title:'Diarista em Santo André para faxina | Quem Faz',
  description:'Procura diarista em Santo André? Informe quantos cômodos, o tipo de faxina e quando precisa. Publique seu pedido gratuitamente.'
 },
 'pintor/santo-andre':{
  title:'Pintor em Santo André para casas e apartamentos | Quem Faz',
  description:'Precisa de pintor em Santo André? Descreva os cômodos, estado das paredes e quando deseja pintar. Solicite orçamentos grátis.'
 }
};
// Segunda leva: termos de busca de contratação com dados do Keyword Planner.
// Cobertura é confirmada por id de especialidade no catálogo antes da aplicação.
Object.assign(keywordTargetMeta,{
 'chaveiro/diadema':{
  title:'Chaveiro em Diadema | Peça orçamento no Quem Faz',
  description:'Precisa de chaveiro em Diadema? Explique qual fechadura ou chave precisa de atendimento, informe seu bairro e publique um pedido grátis.'
 },
 'desentupidor/santo-andre':{
  title:'Desentupidor em Santo André | Quem Faz Serviços',
  description:'Ralo, pia ou vaso entupido em Santo André? Descreva o problema, local e urgência e solicite um orçamento pelo Quem Faz.'
 },
 'desentupidor/guarulhos':{
  title:'Desentupidor em Guarulhos | Quem Faz Serviços',
  description:'Precisa desentupir pia, ralo ou vaso em Guarulhos? Informe bairro e detalhes do entupimento para solicitar orçamento gratuitamente.'
 },
 'eletricista/diadema':{
  title:'Eletricista em Diadema para reparos e instalações | Quem Faz',
  description:'Tomada com defeito, disjuntor desarmando ou instalação em Diadema? Publique seu pedido grátis e consulte a cobertura pelo CEP.'
 },
 'tecnico-de-geladeira/diadema':{
  title:'Conserto de geladeira em Diadema | Quem Faz',
  description:'Geladeira sem gelar ou com defeito em Diadema? Descreva marca, modelo e problema e solicite contato de profissionais.'
 },
 'ar-condicionado/guarulhos':{
  title:'Instalação de ar-condicionado em Guarulhos | Quem Faz',
  description:'Precisa instalar ar-condicionado em Guarulhos? Informe modelo, capacidade, local da instalação e solicite orçamento grátis.'
 },
 'vidraceiro/santo-andre':{
  title:'Vidraceiro em Santo André | Reparos e vidros | Quem Faz',
  description:'Precisa trocar vidro, instalar espelho ou fazer reparo em Santo André? Informe medidas e tipo de serviço e peça orçamento grátis.'
 },
 'diarista/guarulhos':{
  title:'Diarista em Guarulhos para faxina | Quem Faz',
  description:'Procura diarista em Guarulhos? Informe os cômodos, tipo de faxina e quando precisa. Publique o pedido gratuitamente.'
 }
});
const metaForLocal=(s,c)=>c?keywordTargetMeta[s.slug+'/'+c.slug]||null:null;
for(const s of services){
 const local=covered.filter(c=>c.ids.has(s.id));
 const detail=fs.readFileSync(path.join(out,'servicos',s.slug,'index.html'),'utf8').match(/<meta name="description" content="([^"]+)"/)?.[1]||'';
 const options=require('../qf-atendimento.js').questions({servico:s.nome}).find(q=>q.key==='detalhes')?.choices||[];
 const examples='<h2>O que você pode solicitar</h2><ul>'+options.filter(x=>!/^outro/i.test(x[1])).map(x=>'<li>'+esc(x[1])+'</li>').join('')+'</ul>';
 const guide=examples+'<p>'+esc(detail)+'</p>'+practicalSection(s)+'<h2>Como preparar seu pedido de '+esc(s.nome)+'</h2><p>Descreva o problema, o tipo de local e o que espera resolver. Se houver equipamentos ou materiais envolvidos, informe modelo, quantidade e condições de acesso. Esses detalhes ajudam o profissional a avaliar o trabalho antes de combinar o orçamento.</p><h2>Como funciona</h2><ol><li>Preencha o formulário nesta página.</li><li>Confirme o local pelo CEP e escolha o prazo.</li><li>Confira seus dados e publique o pedido.</li><li>Acompanhe o pedido e combine o atendimento.</li></ol><h2>Quanto custa?</h2><p>A publicação do pedido é gratuita. O preço do serviço depende do trabalho e deve ser combinado antes da contratação. Não há garantia de resposta imediata.</p>';
 write(urlFor(s),s.id==='cat_eletricista'?'Eletricista perto de você: instalações e reparos | Quem Faz':s.nome+' | Quem Faz',s.id==='cat_eletricista'?'Precisa de eletricista? Informe seu CEP para solicitar reparos, tomadas, disjuntores ou iluminação. Pedido grátis, conforme a cobertura local.':'Precisa de '+s.nome.toLowerCase()+'? Publique seu pedido grátis e consulte as regiões com profissionais cadastrados.',guide+'<h2>Regiões com cadastro nesta profissão</h2>'+(local.length?links(local.map(c=>[urlFor(s,c)+'#pedido',c.nome+' / '+c.uf])):'<p>A cobertura desta profissão ainda não está confirmada nesta atualização. A disponibilidade será verificada para o local informado.</p>'),s,null,!!local.length);
 // Só publique no índice combinações com cobertura cadastrada e formulário próprio.
 for(const c of local){const others=services.filter(x=>c.ids.has(x.id)&&x.id!==s.id);const keywordMeta=metaForLocal(s,c);write(urlFor(s,c),keywordMeta?.title||s.nome+' em '+c.nome+' / '+c.uf+' | Quem Faz',keywordMeta?.description||'Solicite '+s.nome.toLowerCase()+' em '+c.nome+' / '+c.uf+'. Descreva o serviço e publique seu pedido grátis no Quem Faz.', '<h2>'+esc(s.nome)+' em '+esc(c.nome)+'</h2><p>Há cadastro de profissional com esta especialidade e região de atendimento em '+esc(c.nome)+' / '+c.uf+' na consulta de 04/11/2026. Isso não representa disponibilidade imediata: o atendimento depende do endereço, do raio e da agenda de cada profissional. O CEP informado no pedido determina o local real do serviço.</p>'+guide+'<h2>Outros serviços com cobertura cadastrada em '+esc(c.nome)+'</h2>'+links(others.map(x=>[urlFor(x,c),x.nome]))+'<h2>Outras regiões para '+esc(s.nome)+'</h2>'+links(local.filter(x=>x!==c).map(x=>[urlFor(s,x),x.nome+' / '+x.uf])),s,c);}
}
// Titulos e descricoes especificos para buscas locais com impressoes no Search Console.
const localSearchMeta={
 '/servicos/eletricista/santo-andre/':{
  title:'Eletricista em Santo André para reparos e instalações | Quem Faz',
  description:'Disjuntor desarmando, tomada com defeito ou instalação elétrica em Santo André? Descreva o problema e publique seu pedido grátis no Quem Faz.'
 },
 '/servicos/eletricista/diadema/':{
  title:'Eletricista em Diadema para instalações e reparos | Quem Faz',
  description:'Precisa de eletricista em Diadema para tomadas, iluminação ou disjuntores? Informe o bairro e publique seu pedido grátis no Quem Faz.'
 },
 '/servicos/limpeza-de-sofa/sao-bernardo-do-campo/':{
  title:'Limpeza de sofá em São Bernardo do Campo | Quem Faz',
  description:'Sofá manchado, encardido ou com odores em São Bernardo do Campo? Descreva o tecido e os lugares e solicite orçamentos gratuitamente.'
 }
};
for(const e of editorial){const i=generated.findIndex(p=>p.url===e.url);if(i>=0)generated.splice(i,1);const citySlug=e.url.split('/').filter(Boolean)[2];const editorialCity=covered.find(c=>c.slug===citySlug&&c.ids.has(e.service.id))||null;const meta=metaForLocal(e.service,editorialCity)||localSearchMeta[e.url];write(e.url,meta?.title||e.title,meta?.description||e.description,e.content+practicalSection(e.service),e.service,editorialCity,true);}
// Atualiza também combinações antigas sem cobertura confirmada, preservando a URL.
function preserve(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())preserve(p);else if(e.name==='index.html'){
 const url='/'+path.relative(out,path.dirname(p)).split(path.sep).join('/')+'/';
 if(generated.some(x=>x.url===url))continue;
 const parts=url.split('/').filter(Boolean),alias={'limpeza-de-sofa':'cat_limpeza_estofados'},s=services.find(x=>x.slug===parts[1]||x.id===alias[parts[1]]);
 if(!s)continue;
 write(url,s.nome+' — consulte sua região | Quem Faz','Descreva seu serviço de '+s.nome.toLowerCase()+' e consulte a disponibilidade para o CEP informado.','<h2>Consulte a disponibilidade</h2><p>A cobertura desta combinação de serviço e região não está confirmada nesta consulta. Informe o CEP real no formulário. A publicação não garante a disponibilidade de um profissional.</p><h2>Regiões confirmadas para esta profissão</h2>'+links(covered.filter(c=>c.ids.has(s.id)).map(c=>[urlFor(s,c),c.nome+' / '+c.uf])),s,null,false);
}}}
preserve(path.join(out,'servicos'));
// Os guias de cidade reúnem o catálogo real de cobertura, sem clonar páginas por profissão.
for(const c of covered){const catalog=services.filter(s=>c.ids.has(s.id));
 write('/servicos/cidades/'+c.slug+'/', 'Serviços em '+c.nome+' / '+c.uf+' | Quem Faz', 'Consulte as '+catalog.length+' categorias com profissionais cadastrados para atender '+c.nome+' / '+c.uf+' e escolha o serviço para publicar seu pedido grátis.', '<h2>Serviços com cobertura cadastrada em '+esc(c.nome)+'</h2><p>Este catálogo reúne as especialidades associadas a '+esc(c.nome)+' / '+c.uf+' pelos profissionais no Quem Faz. A consulta foi feita em 04/11/2026. Escolha a profissão para descrever o serviço e confirme seu endereço pelo CEP. O raio e a agenda do profissional determinam o atendimento.</p>'+links(catalog.map(s=>[urlFor(s,c)+'#pedido',s.nome]))+'<h2>Prepare as informações do seu pedido</h2><p>Informe o CEP e o bairro do local em '+esc(c.nome)+', explique o problema e escolha quando precisa do atendimento. Evite colocar endereço completo e telefone na descrição pública. Você informa o contato no formulário, na etapa própria.</p><h2>O que combinar antes de contratar</h2><p>Confirme se o profissional atende seu bairro, o valor do trabalho, quem fornece materiais e o prazo. A publicação é gratuita e não obriga a contratar. Você acompanha o pedido no Quem Faz.</p><h2>Catálogo por profissão</h2>'+links(catalog.map(s=>[urlFor(s),s.nome])));
}
const priorityIds=new Set(['cat_eletricista','cat_encanador','cat_diarista','cat_pintor','cat_montador','cat_limpeza_estofados']);
const priorityLinks=services.filter(s=>priorityIds.has(s.id)&&covered.some(c=>c.ids.has(s.id))).map(s=>[urlFor(s),s.nome]);
write('/servicos/','Encontre serviços na sua região | Quem Faz','Escolha o serviço e publique seu pedido grátis. Consulte a cobertura cadastrada por profissão e região.', '<h2>Encontre um serviço</h2><p>Escolha uma profissão e consulte as cidades com profissionais cadastrados. A disponibilidade depende do CEP e do raio de atendimento.</p>'+links(priorityLinks)+'<h2>Qual serviço você precisa?</h2>'+links(services.filter(s=>covered.some(c=>c.ids.has(s.id))).map(s=>[urlFor(s),s.nome]))+'<h2>Regiões cadastradas</h2>'+links(covered.map(c=>['/servicos/cidades/'+c.slug+'/',c.nome+' / '+c.uf]))+covered.map(c=>'<section id="regiao-'+c.slug+'"><h3>'+esc(c.nome)+' / '+c.uf+'</h3>'+links(services.filter(s=>c.ids.has(s.id)).map(s=>[urlFor(s,c)+'#pedido',s.nome]))+'</section>').join(''));
// Preserve arquivos e URLs anteriores sem afirmar cobertura para combinações inexistentes.
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name==='index.html'){let h=fs.readFileSync(p,'utf8');h=h.replace(/<script data-qf-direct-organic>[\s\S]*?<\/script>/g,'').replace(/<noscript><meta http-equiv="refresh"[^>]*><\/noscript>/g,'');fs.writeFileSync(p,h);}}}
walk(path.join(out,'servicos'));
let sitemap=fs.readFileSync(path.join(out,'sitemap.xml'),'utf8').replace(/<url>\s*<loc>https:\/\/quemfazservico\.com\.br\/servicos\/[\s\S]*?<\/url>/g,'');
sitemap=sitemap.replace('</urlset>',generated.filter(x=>x.index).map(x=>'<url><loc>'+base+x.url+'</loc></url>').join('\n')+'\n</urlset>');fs.writeFileSync(path.join(out,'sitemap.xml'),sitemap);
const indexFile=path.join(out,'servicos','index.html');let indexHtml=fs.readFileSync(indexFile,'utf8');
const discover=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).filter(u=>u!==base+'/servicos/'&&u!==base+'/').map(u=>{const p=new URL(u).pathname;const f=path.join(out,p,'index.html');const t=fs.existsSync(f)?fs.readFileSync(f,'utf8').match(/<title>([^<]+)<\/title>/)?.[1]:p;return [u,t||p];});
indexHtml=indexHtml.replace('</article>','<h2>Guias de serviços e regiões</h2>'+links(discover)+'</article>');indexHtml=require('./seo-directory-layout.cjs')(indexHtml,services.filter(s=>covered.some(c=>c.ids.has(s.id))),covered,urlFor,esc);
fs.writeFileSync(indexFile,indexHtml);
fs.writeFileSync(path.join(out,'seo-205-manifest.json'),JSON.stringify({date:'2026-11-04',regions:covered.map(c=>({cidade:c.nome,uf:c.uf})),pages:generated},null,2));
console.log('Issue 205: '+covered.length+' regiões, '+generated.length+' páginas com formulário e navegação; locais sem cobertura confirmada com noindex.');
