const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../dist');
const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
test('GEO: Osasco e Suzano têm páginas reais, formulário e respostas visíveis',()=>{
 for(const slug of ['eletricista/osasco','encanador/osasco','eletricista/suzano','pedreiro/suzano']){
  const route='/servicos/'+slug+'/';
  assert.ok(sitemap.includes('<loc>https://quemfazservico.com.br'+route+'</loc>'),route);
  const html=fs.readFileSync(path.join(root,route,'index.html'),'utf8');
  assert.ok(html.includes('data-qf-ai-editorial')&&html.includes('id="seo-order"')&&html.includes('href="#pedido"'),route);
  const json=JSON.parse(html.match(/<script type="application\/ld\+json" data-qf-ai-schema>([^<]+)<\/script>/)[1]);
  assert.equal(json['@type'],'Service');assert.equal(json.url,'https://quemfazservico.com.br'+route);assert.equal(json.broker.name,'Quem Faz Serviços');
  assert.ok(!json.aggregateRating&&!json.offers&&!json.provider);
 }
});
