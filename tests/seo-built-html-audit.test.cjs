const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../dist');
const origin='https://quemfazservico.com.br';
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
const locs=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
const readUrl=url=>{const p=new URL(url);assert.equal(p.origin,origin);assert.ok(!p.search&&!p.hash);const pathname=decodeURIComponent(p.pathname);assert.ok(!pathname.includes('..'));return fs.readFileSync(path.join(root,pathname,'index.html'),'utf8');};
test('SEO release: sitemap points to distinct, public HTML pages with metadata',()=>{
 assert.ok(locs.length>=100);
 assert.equal(new Set(locs).size,locs.length);
 for(const url of locs){
  const html=readUrl(url),head=html.split('</head>')[0];
  assert.match(head,/<title>[^<]+<\/title>/i,url+' title');
  assert.match(head,/<meta name="description" content="[^"]+"/i,url+' description');
  const canonical=[...head.matchAll(/<link rel="canonical" href="([^"]+)"/gi)].map(m=>m[1]);
  assert.equal(canonical.length,1,url+' exactly one canonical');
  assert.equal(canonical[0],url,url+' canonical must be self');
  assert.doesNotMatch(head,/<meta name="robots" content="[^"]*noindex/i,url+' sitemap noindex');
  assert.doesNotMatch(html,/\b(?:CPF|CNPJ)\s*[:=]\s*\d{3}|\b(?:senha|password|access_token|refresh_token)\s*[:=]\s*["'][^"']+/i,url+' sensitive data');
 }
});
test('SEO release: the local sitemap contains a curated list, with legacy URLs kept in noindex',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'seo-205-manifest.json'),'utf8'));
 const local=manifest.pages.filter(page=>page.service&&page.city);
 const indexed=local.filter(page=>page.index);
 assert.ok(indexed.length>=30&&indexed.length<=60,indexed.length);
 for(const page of manifest.pages){
  assert.equal(locs.includes(origin+page.url),page.index,page.url);
  if(!page.index) assert.match(readUrl(origin+page.url).split('</head>')[0],/<meta name="robots" content="noindex,follow">/i,page.url);
 }
 for(const route of ['/servicos/eletricista/muzambinho/','/servicos/montador-de-moveis/itanhaem/','/servicos/professor-particular/maua/']){
  assert.ok(!locs.includes(origin+route),route);
  assert.match(readUrl(origin+route).split('</head>')[0],/<meta name="robots" content="noindex,follow">/i,route);
 }
 assert.ok(locs.includes(origin+'/servicos/encanador/santo-andre/'));
});
test('Five sofa guides have unique local content, working form markup, and matching legacy redirects',()=>{
 const cities={
  'santo-andre':'Santo André',
  'sao-bernardo-do-campo':'São Bernardo do Campo',
  maua:'Mauá',
  diadema:'Diadema',
  'sao-paulo':'São Paulo'
 };
 const redirects=require('../vercel.json').redirects;
 const uniqueSections=new Set();
 for(const [slug,city] of Object.entries(cities)){
  const route='/servicos/limpeza-de-sofa/'+slug+'/';
  assert.ok(locs.includes(origin+route),route);
  const html=readUrl(origin+route);
  const config=JSON.parse(html.match(/<script id="seo-config" type="application\/json">([^<]+)<\/script>/)[1]);
  assert.equal(config.city,city);
  assert.equal(config.id,'cat_limpeza_estofados');
  assert.ok(html.includes('<h1>Limpeza de sofá em '+city+'</h1>'));
  assert.ok(html.includes('id="seo-order"')&&html.includes('href="#pedido"'));
  assert.doesNotMatch(html,/data-qf-direct-organic|http-equiv="refresh"/i);
  uniqueSections.add(html.match(/data-qf-sofa-editorial><h2>([^<]+)<\/h2>/)[1]);
  for(const alias of ['limpeza-de-sofa','higienizacao-de-sofa']){
   const rule=redirects.find(r=>r.source==='/'+alias+'/'+slug);
   assert.equal(rule?.destination,route);
   assert.equal(rule?.permanent,true);
  }
 }
 assert.equal(uniqueSections.size,5);
 assert.ok(!locs.some(url=>/^\/(?:limpeza-de-sofa|higienizacao-de-sofa)\//.test(new URL(url).pathname)));
});
