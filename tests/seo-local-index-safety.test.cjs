const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const source=fs.readFileSync(path.join(__dirname,'../scripts/generate-seo-pages.cjs'),'utf8');
test('páginas locais genéricas têm noindex e páginas de serviço mantêm index',()=>{
 const tags=[...source.matchAll(/<meta name="robots" content="([^"]+)">/g)].map(x=>x[1]);
 assert.deepEqual(tags,['index,follow','noindex,follow']);
});
test('sitemap base não inclui URLs locais genéricas',()=>{
 const part=source.slice(source.indexOf('const sm='));assert.ok(part.includes('services.map'));assert.ok(!part.includes('cities.map'));
});
