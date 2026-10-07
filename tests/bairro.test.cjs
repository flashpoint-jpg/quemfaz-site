const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{test}=require('node:test');
const html=fs.readFileSync('index.html','utf8');
test('bairro continua obrigatório e preenchido com cidade/UF vindas da home',()=>{
 const ctx={global:{QFHomeDraft:{region:{cidade:'Santo André',uf:'SP',bairro:'Vila Pires'}}},sessionStorage:{getItem:()=>null},DB:{categoryById:()=>null,categories:()=>[]},PU:{escapeHtml:s=>String(s||'')},field:(label,input)=>input,icon:()=>'',prazoFieldHtml:()=>'',cadastroClienteAdsHtml:()=>''};ctx.global.QFGeo={ufOptions:()=>''};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('  function cadastroClienteView()'),html.indexOf('  // V11.5.0: escolha')),ctx);
 for(const region of [{cidade:'Santo André',uf:'SP',bairro:'Vila Pires'},{cidade:'Santo André',bairro:'Centro'},{}]){ctx.global.QFHomeDraft.region=region;const view=ctx.cadastroClienteView();assert.match(view,/name="bairro"[^>]*required/);assert.ok(view.includes('value="'+(region.bairro||'')+'"'));}
});
test('bairro digitado é levado da home ao rascunho do pedido',async()=>{
 const ctx={homeLocation:{value:'Santo André / SP'},homeRegion:null,homeNeighborhood:{value:' Vila Pires '},landingSearch:{value:'Pintor'},global:{}};vm.createContext(ctx);
 vm.runInContext(html.slice(html.indexOf('      async function saveHomeDraft(){'),html.indexOf('      function landingNorm(')),ctx);await ctx.saveHomeDraft();assert.equal(ctx.global.QFHomeDraft.region.bairro,'Vila Pires');assert.equal(ctx.global.QFHomeDraft.region.cidade,'Santo André');
});
