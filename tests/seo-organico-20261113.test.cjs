const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../dist');
const slugs=['eletricista/santo-andre','eletricista/diadema','encanador/sao-bernardo-do-campo','diarista/santo-andre','pintor/maua','eletricista/guarulhos','montador-de-moveis/sao-bernardo-do-campo','pintor/guarulhos','diarista/guarulhos','encanador/guarulhos'];
test('SEO orgânico: 10 páginas preservam formulário, canonical, links e conteúdo após build',()=>{
 const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
 for(const slug of slugs){
  const uri='https://quemfazservico.com.br/servicos/'+slug+'/';
  assert.ok(sitemap.includes('<loc>'+uri+'</loc>'),slug+' sitemap');
  const html=fs.readFileSync(path.join(root,'servicos',slug,'index.html'),'utf8');
  assert.ok(html.includes('rel="canonical" href="'+uri+'"'),slug+' canonical');
  assert.ok(html.includes('id="seo-order"')&&html.includes('href="#pedido"'),slug+' pedido');
  assert.ok(html.includes('data-qf-organico-20261113'),slug+' reforço');
  assert.ok(html.includes('href="/servicos/"'),slug+' link interno');
  assert.doesNotMatch(html,/<meta name="robots" content="noindex/i,slug+' indexação');
  assert.equal((html.match(/data-qf-organico-20261113/g)||[]).length,1,slug+' bloco único');
 }
});
