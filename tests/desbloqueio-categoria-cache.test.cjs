const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('scripts/qf-other-jobs-extension.js','utf8');
function setup(){
 const user={id:'prof',categorias:['cat_eletricista']};
 let calls=0;
 let rows=[{id:'eletrica',categoria:'cat_eletricista',vagas:1},{id:'pintura',categoria:'cat_pintor',vagas:1}];
 const ctx={PU:{escapeHtml:String},DB:{getSession:()=>({userId:user.id}),profissionalById:()=>user,categoryById:()=>null,qfServicoCompatibilidadeGasista:(u,r)=>u.categorias.includes(r.categoriaId)},icon:()=>'',global:{QFCloud:{client:{rpc:async()=>{calls++;return {data:rows}}}}}};
 vm.createContext(ctx);
 vm.runInContext(source.slice(0,source.indexOf('Screens.profOutrosPedidosRender')),ctx);
 const start=source.indexOf('async function qfOutrosLoad(');
 vm.runInContext(source.slice(start,source.indexOf('function qfOutrosFiltrar(',start)),ctx);
 return {ctx,user,calls:()=>calls,setRows:r=>rows=r};
}
test('categoria cadastrada nunca recebe mensagem de outra profissão',()=>{
 const {ctx}=setup();
 const own=ctx.qfOutrosCard({id:'eletrica',categoria:'cat_eletricista',vagas:1});
 assert.match(own,/Esta profissão já está cadastrada/);
 assert.doesNotMatch(own,/Este serviço pertence a outra profissão/);
 assert.match(own,/Ver pedidos para você/);
 const other=ctx.qfOutrosCard({id:'pintura',categoria:'cat_pintor',vagas:1});
 assert.match(other,/Este serviço pertence a outra profissão/);
 assert.doesNotMatch(other,/Ver pedidos para você/);
});
test('cache de Outros é invalidado ao cadastrar profissão e remove itens compatíveis',async()=>{
 const {ctx,user,calls}=setup();
 let rows=await ctx.qfOutrosLoad(user,false);
 assert.deepEqual(Array.from(rows,r=>r.id),['pintura']);
 await ctx.qfOutrosLoad(user,false);assert.equal(calls(),1);
 user.categorias.push('cat_pintor');
 rows=await ctx.qfOutrosLoad(user,false);
 assert.equal(calls(),2);assert.equal(rows.length,0);
});
test('resposta anterior à edição de profissões não repõe o cache antigo',async()=>{
 const {ctx,user}=setup();let finish;
 ctx.global.QFCloud.client.rpc=()=>new Promise(resolve=>{finish=resolve;});
 const old=ctx.qfOutrosLoad(user,false);const finishOld=finish;
 user.categorias.push('cat_pintor');
 const current=ctx.qfOutrosLoad(user,false);
 finish({data:[]});await current;
 finishOld({data:[{id:'pintura',categoria:'cat_pintor',vagas:1}]});await old;
 const cached=await ctx.qfOutrosLoad(user,false);assert.equal(cached.length,0);
});
