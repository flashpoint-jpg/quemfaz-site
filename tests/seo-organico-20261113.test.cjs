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

test('Guias de orçamento têm fonte, link no guia da cidade e acesso ao formulário', () => {
  const cases = [
    ['encanador/santo-andre', 'cronoshare.com.br', 'R$ 120 a R$ 220'],
    ['diarista/guarulhos', 'cronoshare.com.br', 'R$ 120 a R$ 180'],
    ['limpeza-de-sofa/sao-bernardo-do-campo', 'guiasaobernardodocampo.com.br', 'R$ 149,90']
  ];
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  for (const [slug, source, price] of cases) {
    const url = '/servicos/' + slug + '/';
    const html = fs.readFileSync(path.join(root, url, 'index.html'), 'utf8');
    const indexed = sitemap.includes('<loc>https://quemfazservico.com.br' + url + '</loc>');
    const city = slug.split('/')[1];
    const guide = fs.readFileSync(path.join(root, 'servicos', 'cidades', city, 'index.html'), 'utf8');
    if (!indexed && slug.startsWith('limpeza-de-sofa/')) {
      assert.match(html, /<meta name="robots" content="noindex,follow">/);
      assert.ok(!html.includes('data-qf-orcamento-local'));
      assert.ok(!guide.includes('href="' + url + '"'));
      continue;
    }
    const section = html.match(/<section [^>]*data-qf-orcamento-local>[\s\S]*?<\/section>/g);
    assert.equal(section?.length, 1, slug);
    assert.ok(section[0].includes(source) && section[0].includes(price), slug);
    assert.ok(section[0].includes('href="#pedido"') && html.includes('id="seo-order"'), slug);
    assert.ok(indexed, slug);
    assert.ok(guide.includes('href="' + url + '"'), city);
  }
});
