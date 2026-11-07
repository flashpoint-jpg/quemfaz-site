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
test('SEO release: covered local services are in the sitemap and unconfirmed legacy pages stay noindex',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'seo-205-manifest.json'),'utf8'));
 const covered=manifest.pages.filter(page=>page.service&&page.city);
 assert.ok(covered.length>0);
 for(const page of covered) assert.ok(locs.includes(origin+page.url),page.url);
 for(const route of ['/servicos/eletricista/muzambinho/','/servicos/encanador/santo-andre/']){
  assert.ok(locs.includes(origin+route),route);
 }
 const unconfirmed=manifest.pages.filter(page=>page.service&&!page.city&&!page.index
  &&page.url.split('/').filter(Boolean).length===3);
 assert.ok(unconfirmed.length>0);
 for(const page of unconfirmed){
  const url=origin+page.url;
  assert.ok(!locs.includes(url),url);
  assert.match(readUrl(url).split('</head>')[0],/<meta name="robots" content="noindex,follow">/i,url);
 }
});
