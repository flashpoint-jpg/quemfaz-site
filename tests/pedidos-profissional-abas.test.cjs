// Tela Pedidos do profissional: abas Em andamento / Histórico e "Remover da lista".
// Roda só com Node: extrai do index.html o código real da tela e o executa com dados de teste.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261025180000_profissional_ocultar_servico_da_lista.sql'),'utf8');

function slice(from,to){const a=html.indexOf(from),b=html.indexOf(to,a);assert.ok(a>0&&b>a,'trecho não encontrado: '+from);return html.slice(a,b);}
const telaCodigo=slice('  // Tela Pedidos do profissional: duas abas compactas.','  function servicoCard(req) {');
const bindCodigo=slice('  function bindProfServicos(content, user) {','  function bindHome(content, user) {');

const STATUS={BUSCANDO:'buscando',SEM_PROFISSIONAL:'sem_profissional',AGUARDANDO_ACEITE:'aguardando_aceite',AGUARDANDO_ORCAMENTO:'aguardando_orcamento',ORCAMENTO_ENVIADO:'orcamento_enviado',ORCAMENTO_RECUSADO:'orcamento_recusado',NAO_SELECIONADO:'nao_selecionado',APROVADO:'aprovado',EM_ANDAMENTO:'em_andamento',SERVICO_CONCLUIDO:'servico_concluido',PAGO:'pago',FINALIZADO:'finalizado',CANCELADO:'cancelado'};

function ambiente(pedidos,{rpc}={}){
  const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
  const calls={navigate:[],toast:[],confirm:[],rpc:[]};
  let confirmAnswer=true;
  const ctx={
    STATUS,localStorage:store(),sessionStorage:store(),
    DB:{state:{servicosOcultos:{userId:'pro1',ids:[]}},requestsByProfissional:id=>pedidos.filter(p=>p.profissionalId===id)},
    PU:{escapeHtml:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      confirmDialog:o=>{calls.confirm.push(o);return Promise.resolve(confirmAnswer);},toast:(m,t)=>calls.toast.push({m,t})},
    icon:n=>'<svg data-i="'+n+'"></svg>',Screens:{},
    servicoCard:r=>'<article data-card="'+r.id+'">'+r.status+'</article>',
    global:{navigate:(...a)=>calls.navigate.push(a),QFCloud:{client:{rpc:async(n,a)=>{calls.rpc.push({n,a});return rpc?rpc(n,a):{data:{ok:true},error:null};}}}}
  };
  vm.createContext(ctx);
  vm.runInContext('(function(){'+telaCodigo+bindCodigo+'; this.__tela=Screens.profServicosRender; this.__bind=bindProfServicos; }).call(this)',ctx);
  return {ctx,calls,render:()=>ctx.__tela({}, {id:'pro1'}),bind:()=>{const c={listeners:[]};c.addEventListener=(t,f)=>c.listeners.push(f);ctx.__bind(c,{id:'pro1'});return c;},setConfirm:v=>{confirmAnswer=v;}};
}
const pedido=(id,status,cliente)=>({id,status,cliente,profissionalId:'pro1'});
const cenario=[
  pedido('neg1','aguardando_orcamento','Ana'),pedido('and1','em_andamento','Beto'),
  pedido('miriam','servico_concluido','Miriam'),pedido('ronny','servico_concluido','Ronny'),
  pedido('pago1','pago','Carla'),pedido('fim1','finalizado','Davi'),pedido('canc1','cancelado','Eva')
];
const ids=h=>[...h.matchAll(/data-card="([^"]+)"/g)].map(m=>m[1]);
const clique=(alvo)=>({target:{closest:sel=>alvo[sel]||null},preventDefault(){},stopPropagation(){}});

test('Em andamento mostra somente serviços ativos ou em negociação',()=>{
  const a=ambiente(cenario);const h=a.render();
  assert.deepEqual(ids(h).sort(),['and1','neg1']);
  assert.match(h,/data-prof-aba="andamento"[^>]*>Em andamento<span class="qf-ped-tab__n">2</);
  assert.match(h,/data-prof-aba="historico"[^>]*>Histórico<span class="qf-ped-tab__n">5</);
  assert.doesNotMatch(h,/data-hide-servico/,'serviço ativo nunca tem botão de remover');
});

test('Concluídos (Miriam, Ronny, pagos, finalizados) vão para o Histórico, com Remover da lista',()=>{
  const a=ambiente(cenario);a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');const h=a.render();
  assert.deepEqual(ids(h).sort(),['canc1','fim1','miriam','pago1','ronny']);
  assert.equal((h.match(/data-hide-servico=/g)||[]).length,5);
  assert.match(h,/Remover da lista/);
  assert.doesNotMatch(h,/data-card="(neg1|and1)"/);
});

test('Serviço ativo nunca aparece no Histórico nem o concluído em Em andamento',()=>{
  const a=ambiente(cenario);
  const and=ids(a.render());a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');const his=ids(a.render());
  assert.equal(and.filter(x=>his.includes(x)).length,0);
});

test('Pedido que muda para concluído sai de Em andamento sozinho',()=>{
  const lista=[pedido('x1','em_andamento','Zé')];const a=ambiente(lista);
  assert.deepEqual(ids(a.render()),['x1']);
  lista[0].status='servico_concluido';
  assert.deepEqual(ids(a.render()),[]);
  a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');assert.deepEqual(ids(a.render()),['x1']);
});

test('Trocar de aba grava a escolha e recarrega a tela',()=>{
  const a=ambiente(cenario);const c=a.bind();
  c.listeners[0](clique({'[data-prof-aba]':{getAttribute:()=> 'historico'}}));
  assert.equal(a.ctx.sessionStorage.getItem('qf_prof_servicos_aba'),'historico');
  assert.deepEqual(a.calls.navigate[0],['/profissional/servicos',true]);
});

test('Remover da lista pede confirmação; cancelar não remove nada',async()=>{
  const a=ambiente(cenario);a.setConfirm(false);const c=a.bind();
  c.listeners[0](clique({'[data-hide-servico]':{getAttribute:()=> 'miriam'}}));await new Promise(r=>setTimeout(r,5));
  assert.equal(a.calls.confirm.length,1);assert.match(a.calls.confirm[0].message,/sai apenas da sua lista/);
  assert.equal(a.calls.rpc.length,0);assert.equal(a.calls.navigate.length,0);
  a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');assert.ok(ids(a.render()).includes('miriam'));
});

test('Confirmar remove só da lista: usa apenas a função de ocultar e esconde o cartão',async()=>{
  const a=ambiente(cenario);const c=a.bind();
  c.listeners[0](clique({'[data-hide-servico]':{getAttribute:()=> 'miriam'}}));await new Promise(r=>setTimeout(r,5));
  assert.deepEqual(a.calls.rpc.map(x=>x.n),['qf_profissional_ocultar_servico']);
  assert.equal(JSON.stringify(a.calls.rpc[0].a),'{"p_chamado_id":"miriam"}');
  a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');const h=a.render();
  assert.ok(!ids(h).includes('miriam'));assert.ok(ids(h).includes('ronny'));
  assert.match(h,/qf-ped-tab__n">4</);
  assert.equal(a.calls.toast.at(-1).t,'success');
});

test('Se o servidor recusar (serviço ainda ativo), o cartão não some',async()=>{
  const a=ambiente(cenario,{rpc:async()=>({data:{ok:false,reason:'Só é possível remover serviços já encerrados.'},error:null})});const c=a.bind();
  c.listeners[0](clique({'[data-hide-servico]':{getAttribute:()=> 'miriam'}}));await new Promise(r=>setTimeout(r,5));
  a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');assert.ok(ids(a.render()).includes('miriam'));
  assert.equal(a.calls.toast.at(-1).t,'danger');
});

test('Telas vazias têm mensagem própria em cada aba',()=>{
  const a=ambiente([]);assert.match(a.render(),/Nenhum serviço em andamento/);
  a.ctx.sessionStorage.setItem('qf_prof_servicos_aba','historico');assert.match(a.render(),/Nenhum serviço no histórico/);
});

test('Uma única escuta de clique por tela (sem confirmação duplicada)',()=>{
  const a=ambiente(cenario);const c=a.bind();a.ctx.__bind(c,{id:'pro1'});assert.equal(c.listeners.length,1);
});

test('Migração: só oculta, nunca apaga nem toca em avaliações, financeiro ou comissão de 13%',()=>{
  const sql=migration.replace(/--.*$/gm,'');
  assert.doesNotMatch(sql,/\b(delete\s+from|truncate|drop\s+table|update\s+public\.)/i);
  for(const t of ['qf_desbloqueios','qf_avaliacoes','qf_movimentacoes_carteira','qf_carteiras','qf_comissao13','qf_recargas','qf_planos_profissional']){
    assert.doesNotMatch(sql,new RegExp('(insert\\s+into|update|delete\\s+from)\\s+public\\.'+t,'i'),t+' não pode ser alterada');
  }
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on function public\.qf_profissional_ocultar_servico\(uuid\) from public, anon/i);
  assert.match(sql,/v_status not in \('concluido', 'finalizado', 'cancelado', 'expirado'\)/);
  assert.match(sql,/d\.profissional_id = v_prof/);
});

test('Regras financeiras e a comissão de 13% não foram tocadas pela tela',()=>{
  const bloco=telaCodigo+bindCodigo;
  assert.doesNotMatch(bloco,/comissao|13%|carteira|valor_centavos|qf_comissao13/i);
});

test('Status concluído/finalizado do banco é reconhecido no app',()=>{
  const m=html.match(/function localStatus\(status\) \{[\s\S]*?\}\)\[status\]/)[0];
  assert.match(m,/concluido: S\.SERVICO_CONCLUIDO/);assert.match(m,/finalizado: S\.FINALIZADO/);
});

test('Visual aprovado: azul, laranja, cartões arredondados',()=>{
  const css=html.slice(html.indexOf('.qf-ped-tabs {'),html.indexOf('.qf-hist-remove svg'));
  assert.match(css,/#1764D8/);assert.match(css,/#FF7900/);assert.match(css,/border-radius:16px/);
});

test('Versão do app e do service worker foram atualizadas juntas',()=>{
  const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8'),build=fs.readFileSync(path.join(root,'scripts/build-client.cjs'),'utf8');
  const v=/const SW_VERSION = '([^']+)'/.exec(sw)[1];
  assert.ok(build.includes("const APP_VERSION = '"+v+"'"));assert.equal(v,'12.1.31');
});
