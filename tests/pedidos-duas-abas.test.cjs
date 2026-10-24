const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync('scripts/qf-other-jobs-extension.js','utf8');
function setup(){
 const dom=new JSDOM('<html><head></head><body><main></main></body></html>');
 const user={id:'prof',online:true,categorias:['eletricista','montador'],horarioInicio:'08:00',horarioFim:'18:00'};
 let rows=[];
 const ctx={document:dom.window.document,window:{},PU:{escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')},icon:()=>'',DB:{categoryById:id=>({nome:id}),cityById:()=>null,chamadasPendentes:()=>rows,requestById:id=>rows.find(r=>r.id===id)},Screens:{profHomeRender:()=>'<div class="view"><div id="chamados-disponiveis"></div></div>',profChamadaRender:()=>'<div class="view">Desbloquear</div>',profServicosDisponiveisRender:()=>'<div class="view"><div id="chamados-disponiveis"></div></div>',afterRender:()=>{}}};
 vm.createContext(ctx);vm.runInContext(source,ctx);
 const row=(id,cat,far=false,more={})=>({id,categoriaId:cat,foraRaio:far,distanciaKm:far?50:5,endereco:{cidade:'Santo André',uf:'SP',bairro:'Centro'},descricao:'Pedido real retornado pelo servidor',limiteParticipantes:4,participantes:1,criadoEm:'2026-10-24T10:00:00Z',...more});
 rows=[row('near','eletricista'),row('old','montador',true),row('new','eletricista',true,{criadoEm:'2026-10-24T12:00:00Z'}),row('wrong','pintor',true),row('full','montador',true,{participantes:4}),row('unlocked','eletricista',true,{profissionalId:'prof'}),row('near','eletricista')];
 return {ctx,user,dom,setRows:r=>rows=r,row,getRows:()=>rows};
}
test('duas abas: profissões múltiplas, sem duplicados, cheios ou desbloqueados e ordem recente',()=>{
 const {ctx,user}=setup(),g=ctx.window.QFPedidosGrupos(user);
 assert.deepEqual(Array.from(g.perto,r=>r.id),['near']);assert.deepEqual(Array.from(g.mais,r=>r.id),['new','old']);
 user.categorias=['montador'];const single=ctx.window.QFPedidosGrupos(user);
 assert.equal(single.perto.length,0);assert.deepEqual(Array.from(single.mais,r=>r.id),['old']);
});
test('troca de abas preserva dados, mostra região/km/contatos e atualiza contagens',()=>{
 const {ctx,user,dom,setRows,row}=setup(),main=dom.window.document.querySelector('main');
 main.innerHTML=ctx.Screens.profHomeRender({},user);ctx.Screens.afterRender('/profissional/home',main,{},user);
 assert.match(main.textContent,/Perto de mim\s*1\s*pedido/);assert.match(main.textContent,/Mais oportunidades\s*2\s*pedido/);
 assert.deepEqual([...main.querySelectorAll('[data-request-id]')].map(e=>e.dataset.requestId),['near']);
 main.querySelector('[data-qf-pedidos-tab="mais"]').click();
 assert.deepEqual([...main.querySelectorAll('[data-request-id]')].map(e=>e.dataset.requestId),['new','old']);
 assert.match(main.textContent,/Centro/);assert.match(main.textContent,/Santo André - SP/);assert.match(main.textContent,/50 km/);assert.match(main.textContent,/3 contatos disponíveis/);
 assert.match(main.textContent,/Sem toque ou push/);assert.equal(main.querySelector('[role="tab"][aria-selected="true"]').dataset.qfPedidosTab,'mais');
 setRows([row('fresh','eletricista',true)]);main.innerHTML=ctx.Screens.profHomeRender({},user);
 assert.match(main.textContent,/Perto de mim\s*0\s*pedido/);assert.match(main.textContent,/Mais oportunidades\s*1\s*pedido/);assert.ok(main.querySelector('[data-request-id="fresh"]'));
});
test('alertas: fora do raio nunca toca; dentro do raio respeita horário e virada da meia-noite',()=>{
 const {ctx,user,row}=setup(),allows=ctx.window.QFPedidosPodeAvisar;
 const inside=new Date('2026-10-24T15:00:00Z'),outside=new Date('2026-10-24T23:00:00Z');
 assert.equal(allows(row('a','eletricista'),user,inside),true);
 assert.equal(allows(row('a','eletricista',true),user,inside),false);
 assert.equal(allows(row('a','pintor'),user,inside),false);
 assert.equal(allows(row('a','eletricista'),user,outside),false);
 user.online=false;assert.equal(allows(row('a','eletricista'),user,inside),false);user.online=true;
 user.horarioInicio='22:00';user.horarioFim='06:00';assert.equal(allows(row('a','eletricista'),user,new Date('2026-10-25T04:00:00Z')),true);
 user.horarioInicio=user.horarioFim='00:00';assert.equal(allows(row('a','eletricista'),user,outside),true);
});
test('detalhe fora do raio tem aviso e preserva o fluxo de desbloqueio existente',()=>{
 const {ctx,user}=setup();assert.match(ctx.Screens.profChamadaRender({id:'old'},user),/Fora do seu raio[\s\S]*Desbloquear/);
});
test('assinatura leve detecta alteração nas vagas, desaparecimento e chegada fora do raio',async()=>{
 const html=fs.readFileSync('index.html','utf8'),a=html.indexOf('  async function professionalQuickSignature()'),b=html.indexOf('\n  let publicAdsSync',a);
 let near=[{id:'a',status:'aberto',participantes:0,limite:4}],far=[];
 const ctx={client:{rpc:async n=>({data:n==='qf_portfolio_servicos'?near:far}),from:()=>({select:async()=>({data:[]})})}};
 vm.createContext(ctx);vm.runInContext(html.slice(a,b),ctx);
 const first=await ctx.professionalQuickSignature();near[0].participantes=1;const second=await ctx.professionalQuickSignature();assert.notEqual(first,second);
 far=[{id:'b',status:'aberto',participantes:0,limite:4}];const third=await ctx.professionalQuickSignature();assert.notEqual(second,third);
 near=[];assert.notEqual(third,await ctx.professionalQuickSignature());
});
