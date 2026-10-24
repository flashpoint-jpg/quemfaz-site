// Duas listas autorizadas pelo servidor: perto (push) e oportunidades (consulta voluntária).
function qfOutrosEsc(value) { return PU.escapeHtml(String(value == null ? '' : value)); }
Screens.profOutrosPedidosRender = function(params,user) {
  qfPedidosTabUser=user.id; qfPedidosTab='mais';
  return Screens.profServicosDisponiveisRender(params,user);
};
let qfPedidosTab='perto',qfPedidosTabUser='';
function qfPedidosNoHorario(user,now) {
  if(!user||!user.online)return false;
  const parse=v=>{const m=/^(\d{2}):(\d{2})$/.exec(String(v).slice(0,5));return m?Number(m[1])*60+Number(m[2]):null;};
  const a=parse(user.horarioInicio||'06:00'),b=parse(user.horarioFim||'22:00');
  if(a===null||b===null)return false;
  if(a===b)return true;
  const n=parse(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now||new Date()));
  return n!==null&&(a<b?n>=a&&n<b:n>=a||n<b);
}
window.QFPedidosPodeAvisar=function(req,user,now){
  return !!(req&&!req.foraRaio&&!req.abertoTodos&&user&&Array.isArray(user.categorias)&&
    user.categorias.indexOf(req.categoriaId)!==-1&&qfPedidosNoHorario(user,now));
};
function qfPedidosGrupos(user) {
  const seen=new Set(),perto=[],mais=[];
  DB.chamadasPendentes(user.id).forEach(function(r){
    if(seen.has(r.id)||r.profissionalId||r.abertoTodos||!Array.isArray(user.categorias)||user.categorias.indexOf(r.categoriaId)===-1)return;
    const lim=Math.min(4,Math.max(1,Number(r.limiteParticipantes||r.maxOrcamentos||3)));
    if(Number(r.participantes||0)>=lim)return;
    seen.add(r.id);(r.foraRaio?mais:perto).push(r);
  });
  perto.sort((a,b)=>Number(a.distanciaKm??Infinity)-Number(b.distanciaKm??Infinity)||String(b.criadoEm||'').localeCompare(String(a.criadoEm||'')));
  mais.sort((a,b)=>String(b.criadoEm||'').localeCompare(String(a.criadoEm||'')));
  return {perto:perto,mais:mais};
}
window.QFPedidosGrupos=qfPedidosGrupos;
// Home simplificada: somente pedidos elegiveis, sem vitrine antiga ou contagem de atividade geral.
function qfOutrosHorario(user) {
  if (!user || !user.online) return null;
  const start=String(user.horarioInicio || '06:00').slice(0,5);
  const end=String(user.horarioFim || '22:00').slice(0,5);
  const parse=function(v){const m=/^(\d{2}):(\d{2})$/.exec(v);return m?Number(m[1])*60+Number(m[2]):null;};
  const a=parse(start),b=parse(end);
  if(a===null||b===null||a===b) return 'Você recebe avisos dos pedidos da sua profissão e região.';
  const now=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const n=parse(now);
  if(n===null)return 'Pedidos da sua profissão e região, conforme seu horário configurado.';
  const inside=a<b?(n>=a&&n<b):(n>=a||n<b);
  return inside
    ? 'Você está recebendo pedidos da sua profissão e região.'
    : 'Você está online. Notificações de novos pedidos pausadas até ' + start + '. Você pode consultar os pedidos no app.';
}
window.QFHomeProCard=qfOutrosProCard;
function qfOutrosProCard(req) {
  const c=DB.categoryById(req.categoriaId);
  const city=DB.cityById(req.cidadeId);
  const place=String(((req.endereco||{}).cidade)||(city&&city.nome)||'Região informada');
  const bairro=String((req.endereco||{}).bairro||'Bairro não informado');
  const uf=String(((req.endereco||{}).uf)||(city&&city.uf)||'');
  const category=(c&&c.nome)||'Serviço';
  const title=qfOutrosEsc(category);
  // Urgente (grátis) vira etiqueta vermelha; Normal aparece discreto; prioridade paga tem selo próprio.
  const U=window.QFUrgencia;
  const tags=U?(U.tagHtml(req)+U.prioridadeHtml(req)):(req.prioridade?'<span class="qf-home-job__badge is-urgent">URGENTE</span>':'');
  const dist=req.distanciaKm==null||!Number.isFinite(Number(req.distanciaKm))?'Distância indisponível':qfOutrosEsc(Number(req.distanciaKm).toLocaleString('pt-BR',{maximumFractionDigits:1})+' km');
  const limit=Math.min(4,Math.max(1,Number(req.limiteParticipantes||req.maxOrcamentos||3)||3));
  const occupied=Math.max(0,Number(req.participantes||0)||0);
  const free=Math.max(0,limit-occupied);
  return '<article class="qf-home-job'+(req.foraRaio?' qf-home-job--fora':'')+'" data-qf-home-job data-request-id="'+qfOutrosEsc(req.id)+'" data-created="'+qfOutrosEsc(req.criadoEm||'')+
    '" data-distance="'+(req.distanciaKm==null?'999999':Number(req.distanciaKm))+'">'+
    '<div class="qf-home-job__symbol">'+icon(c&&c.icon||'briefcase')+'</div>'+
    '<div class="qf-home-job__copy"><span style="display:flex;gap:6px;flex-wrap:wrap;align-self:flex-start">'+tags+(req.foraRaio?'<span class="qf-home-job__badge">Fora do seu raio</span>':'')+'</span>'+
    '<strong>'+title+'</strong><span class="qf-home-job__place">'+icon('mapPin')+' '+qfOutrosEsc(place+(uf?' - '+uf:''))+'</span>'+
    '<span class="qf-home-job__place">'+qfOutrosEsc(bairro)+'</span>'+
    '<small>'+qfOutrosEsc(String(req.descricao||'').slice(0,85))+'</small></div>'+
    '<div class="qf-home-job__action">'+(dist?'<span class="qf-home-job__distance">'+dist+'</span>':'')+
    '<button class="btn btn--primary" type="button" data-nav="/profissional/chamada/'+qfOutrosEsc(req.id)+'">Ver pedido</button>'+
    '<span class="qf-home-job__vagas">'+free+(free===1?' contato disponível':' contatos disponíveis')+'</span></div></article>';
}
function qfOutrosHomePedidos(user) {
  if(qfPedidosTabUser!==user.id){qfPedidosTabUser=user.id;qfPedidosTab='perto';}
  const groups=qfPedidosGrupos(user),selected=qfPedidosTab,rows=groups[selected];
  return '<div class="section qf-home-jobs" id="chamados-disponiveis">'+qfAtendimentoCompacto(user)+
    '<h2 class="qf-pedidos-heading">Pedidos para você</h2>'+
    '<div class="qf-pedidos-tabs" role="tablist" aria-label="Pedidos disponíveis">'+
    ['perto','mais'].map(function(key){const count=groups[key].length,title=key==='perto'?'Perto de mim':'Mais oportunidades';return '<button type="button" role="tab" id="qf-pedidos-'+key+'" aria-label="'+title+' ('+count+')" aria-controls="qf-pedidos-panel" aria-selected="'+(selected===key)+'" tabindex="'+(selected===key?'0':'-1')+'" data-qf-pedidos-tab="'+key+'"><span class="qf-pedidos-tab-title"><span class="qf-pedidos-dot'+(count?' is-lit':'')+'" aria-hidden="true"></span>'+title+'</span><span class="qf-pedidos-total">'+count+' <small>'+(count===1?'pedido':'pedidos')+'</small></span><span class="qf-pedidos-sub">'+(key==='perto'?'Dentro do seu raio':'Fora do seu raio')+'</span></button>';}).join('')+'</div>'+
    '<div id="qf-pedidos-panel" role="tabpanel" aria-labelledby="qf-pedidos-'+selected+'">'+
    '<p class="qf-pedidos-hint text--sm text--secondary">'+(selected==='perto'?'Suas profissões, dentro do seu raio. Avisos conforme seu horário.':'Suas profissões, fora do seu raio. Sem toque ou push. Confira a distância antes de desbloquear.')+'</p>'+
    (rows.length?'<div class="stack--sm" data-qf-home-list>'+rows.map(qfOutrosProCard).join('')+'</div>':
      '<div class="empty-state"><div class="icon-tile icon-tile--ghost">'+icon('search')+'</div>'+
      '<p class="text text--secondary">'+(selected==='perto'?'Nenhum pedido da sua profissão dentro do seu raio agora.':'Nenhuma oportunidade das suas profissões fora do raio agora.')+'</p></div>')+
    '</div></div>';
}
function qfAtendimentoCompacto(user) {
  const areas=user.areasAtendimento||[],area=areas[0]||{},radius=Number(area.raioKm||user.raioKm||10);
  const start=String(user.horarioInicio||'06:00').slice(0,5),end=String(user.horarioFim||'22:00').slice(0,5);
  const format=t=>t.replace(':00','h').replace(':','h');
  const hours=start===end?'Dia todo':format(start)+' às '+format(end);
  const cats=(user.categorias||[]).map(id=>DB.categoryById(id)).filter(Boolean);
  const category=cats.length?cats[0].nome+(cats.length>1?' + '+(cats.length-1):''):'Selecione sua profissão';
  const pending=window.QFProfAtendimento?window.QFProfAtendimento.pendencias(user):0;
  const row=(label,value,action,title)=>'<div class="qf-atd-row"><div><span>'+label+'</span><strong>'+qfOutrosEsc(value)+'</strong></div><button type="button" '+action+'>'+title+'</button></div>';
  return '<details class="qf-atd-compact"><summary><span class="qf-atd-summary-top"><strong>Seu atendimento</strong><span class="qf-atd-adjust">Ajustar '+icon('chevronDown')+'</span></span><span class="qf-atd-values"><span>'+qfOutrosEsc(radius)+' km'+(areas.length>1?' + '+(areas.length-1)+' '+(areas.length===2?'cidade':'cidades'):'')+'</span><span>'+qfOutrosEsc(hours)+'</span>'+(pending?'<span class="qf-atd-pending">'+pending+' '+(pending===1?'pendência':'pendências')+'</span>':'')+'</span></summary><div class="qf-atd-expanded">'+
    row('Raio de atendimento','Até '+radius+' km'+(area.cidade?' · '+area.cidade:''),'data-prof-settings="area"','Ajustar')+
    row('Horário de atendimento',hours,'data-qf-horario-rapido="1"','Ajustar')+
    row('Suas profissões',category,'data-prof-settings="profissao"','Revisar')+
    row('Cadastro e identificação',pending?'Confira os dados pendentes':'Cadastro completo','data-qf-cadastro-rapido',pending?'Regularizar':'Revisar')+
    '</div></details>';
}
const qfOutrosHomeRender = Screens.profHomeRender;
Screens.profHomeRender = function(params,user) {
  // O componente original continua cuidando de online/offline, carteira, QR code,
  // avaliacoes e cadastro; alteramos so os blocos de pedidos e mensagens antigas.
  const html=qfOutrosHomeRender(params,user);
  const holder=document.createElement('div');
  holder.innerHTML=html;
  const legacyAll=holder.querySelector('.qf-abertos');
  if(legacyAll)legacyAll.remove();
  const legacyStats=holder.querySelector('.qf-movimento');
  if(legacyStats)legacyStats.remove();
  const oldShortcut=holder.querySelector('.qf-outros-home-section');
  if(oldShortcut)oldShortcut.remove();
  const oldJobs=holder.querySelector('#chamados-disponiveis');
  if(oldJobs)oldJobs.outerHTML=qfOutrosHomePedidos(user);
  // O resumo já informa a pendência cadastral; não repetir o aviso grande no topo.
  const cadastroNotice=holder.querySelector('[data-cadastro-update]');
  if(cadastroNotice)cadastroNotice.closest('.card').remove();
  const activation=holder.querySelector('[data-ativacao="pendente"]');
  if(activation){
    const fold=document.createElement('details');fold.className='qf-atd-compact qf-atd-activation';
    const missing=activation.querySelectorAll('[data-ativ-feito="0"]').length;
    fold.innerHTML='<summary><span class="qf-atd-summary-top"><strong>App e notificações</strong><span class="qf-atd-adjust">Revisar '+icon('chevronDown')+'</span></span><span class="qf-atd-values">'+missing+' '+(missing===1?'ajuste pendente':'ajustes pendentes')+'</span></summary>';
    fold.appendChild(activation);
    holder.querySelector('#chamados-disponiveis').after(fold);
  }
  const status=holder.querySelector('.qf-prof-estado__msg');
  const update=qfOutrosHorario(user);
  if(status&&update)status.textContent=update;
  // Estado online continua funcional em uma linha; preferências passam para o resumo recolhido.
  const statusCard=holder.querySelector('.qf-prof-status');
  if(statusCard){statusCard.classList.add('qf-prof-status--compact');statusCard.querySelectorAll('.qf-prof-welcome,.qf-radar-meta,#qf-horario-lembrete').forEach(el=>el.remove());}
  return holder.innerHTML;
};
const qfOutrosDisponiveisRender = Screens.profServicosDisponiveisRender;
Screens.profServicosDisponiveisRender = function(params,user) {
  const holder=document.createElement('div');
  holder.innerHTML=qfOutrosDisponiveisRender(params,user);
  const legacy=holder.querySelector('.qf-abertos');
  if(legacy)legacy.remove();
  const jobs=holder.querySelector('#chamados-disponiveis');
  if(jobs)jobs.outerHTML=qfOutrosHomePedidos(user);
  return holder.innerHTML;
};
const qfPedidosDetalheRender=Screens.profChamadaRender;
Screens.profChamadaRender=function(params,user){
  const html=qfPedidosDetalheRender(params,user),req=DB.requestById(params.id);
  if(!req||!req.foraRaio)return html;
  return html.replace('<div class="view">','<div class="view"><div class="qf-pedidos-warning" role="note">Fora do seu raio de atendimento. Confira a distância e o deslocamento antes de desbloquear.</div>');
};
const qfOutrosAfterRender = Screens.afterRender;
Screens.afterRender = function(pattern,content,params,user){
  if (qfOutrosAfterRender) qfOutrosAfterRender(pattern,content,params,user);
  if (!user || !user.id) return;
  if (['/profissional/home','/profissional/servicos/disponiveis','/profissional/outros-pedidos'].indexOf(pattern)!==-1) {
    content.addEventListener('click',function(e){
      const tab=e.target.closest('[data-qf-pedidos-tab]');if(!tab)return;
      qfPedidosTab=tab.getAttribute('data-qf-pedidos-tab');
      const box=content.querySelector('#chamados-disponiveis');
      if(box){box.outerHTML=qfOutrosHomePedidos(user);content.querySelector('[data-qf-pedidos-tab="'+qfPedidosTab+'"]').focus();}
    });
    content.addEventListener('keydown',function(e){
      const tab=e.target.closest('[data-qf-pedidos-tab]');
      if(tab&&['ArrowLeft','ArrowRight','Home','End'].indexOf(e.key)!==-1){
        e.preventDefault();const next=e.key==='Home'?'perto':e.key==='End'?'mais':tab.dataset.qfPedidosTab==='perto'?'mais':'perto';
        content.querySelector('[data-qf-pedidos-tab="'+next+'"]').click();
      }
    });
    content.addEventListener('change',function(e){
      const select=e.target.closest('[data-qf-home-sort]');
      if(!select)return;
      const box=content.querySelector('[data-qf-home-list]');
      if(!box)return;
      const cards=Array.prototype.slice.call(box.querySelectorAll('[data-qf-home-job]'));
      cards.sort(function(a,b){
        if(select.value==='recent')return String(b.getAttribute('data-created')).localeCompare(String(a.getAttribute('data-created')));
        return Number(a.getAttribute('data-distance'))-Number(b.getAttribute('data-distance'));
      });
      cards.forEach(function(card){box.appendChild(card);});
    });
  }
};
(function qfOutrosStyles(){
  if(document.getElementById('qf-outros-style'))return;
  const tag=document.createElement('style');
  tag.id='qf-outros-style';
  tag.textContent=[
   '.qf-pedidos-heading{font-size:19px;font-weight:800;color:#14243b;margin:0 0 12px}',
   '.qf-pedidos-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-bottom:12px}',
   '.qf-pedidos-tabs button{min-width:0;border:2px solid #e2e8f0;border-radius:16px;background:#fff;color:#14243b;font:inherit;text-align:left;padding:13px 11px;cursor:pointer;touch-action:manipulation}',
   '.qf-pedidos-tabs button[aria-selected="true"]{border-color:#1763cf;box-shadow:0 3px 10px #1763cf15}',
   '.qf-pedidos-tab-title{display:flex;align-items:center;gap:8px;min-height:36px;font-size:13px;font-weight:750;line-height:1.3}',
   '.qf-pedidos-dot{width:10px;height:10px;border-radius:50%;background:#bdc6d2;flex:none;position:relative}',
   '[data-qf-pedidos-tab="perto"] .qf-pedidos-dot.is-lit{background:#159b53;color:#159b53}',
   '[data-qf-pedidos-tab="mais"] .qf-pedidos-dot.is-lit{background:#dc3545;color:#dc3545}',
   '.qf-pedidos-dot.is-lit:after{content:"";position:absolute;inset:-4px;border:2px solid currentColor;border-radius:50%;animation:qf-pedidos-pulse 1.8s ease-out infinite}',
   '@keyframes qf-pedidos-pulse{0%{transform:scale(.65);opacity:.65}85%,100%{transform:scale(1.55);opacity:0}}',
   '@media(prefers-reduced-motion:reduce){.qf-pedidos-dot.is-lit:after{animation:none;opacity:.25}}',
   '.qf-pedidos-total{display:flex;gap:5px;align-items:baseline;font-size:29px;font-weight:800;line-height:1.1;margin:10px 0 7px;color:#108043}',
   '[data-qf-pedidos-tab="mais"] .qf-pedidos-total{color:#c6283a}',
   '.qf-pedidos-total small{font-size:12px;font-weight:600}.qf-pedidos-sub{font-size:11px;color:#64748b}',
   '.qf-atd-compact{background:#fff;border:1px solid #e1e7ef;border-radius:14px;padding:0 13px;margin:0 0 17px}',
   '.qf-atd-compact>summary{list-style:none;cursor:pointer;padding:12px 0;min-height:70px}.qf-atd-compact>summary::-webkit-details-marker{display:none}',
   '.qf-atd-summary-top{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:#52637b}.qf-atd-summary-top strong{font-weight:650}',
   '.qf-atd-adjust{display:flex;align-items:center;gap:4px;font-size:12px;color:#2362b5}.qf-atd-adjust svg{width:14px;height:14px}.qf-atd-compact[open] .qf-atd-adjust svg{transform:rotate(180deg)}',
   '.qf-atd-values{display:flex;align-items:center;flex-wrap:wrap;gap:5px 10px;margin-top:7px;font-size:12px;color:#69788c}.qf-atd-values>span+span{border-left:1px solid #dce3ed;padding-left:10px}.qf-atd-pending{color:#9c5a1c}',
   '.qf-atd-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:65px;border-top:1px solid #edf1f6}.qf-atd-row>div{min-width:0}.qf-atd-row span{display:block;font-size:11px;color:#778398}.qf-atd-row strong{display:block;font-size:12px;color:#42546c;overflow-wrap:anywhere;margin-top:4px}.qf-atd-row button{border:0;background:transparent;color:#2362b5;font:inherit;font-size:12px;font-weight:650;min-height:44px;padding:10px 0 10px 8px;cursor:pointer;flex:none}',
   '#app-shell[data-route="profissional-home"] .qf-prof-status--compact{padding:0!important;border:0;box-shadow:none;background:transparent;margin-bottom:10px!important}',
   '#app-shell[data-route="profissional-home"] .qf-prof-status--compact .qf-prof-estado{padding:6px 12px;border:1px solid #cde8d8;border-radius:12px;gap:8px}',
   '#app-shell[data-route="profissional-home"] .qf-prof-status--compact .qf-prof-status__title{font-size:13px}',
   '#app-shell[data-route="profissional-home"] .qf-prof-status--compact .qf-prof-estado__msg{display:none}',
   '#app-shell[data-route="profissional-home"] .qf-prof-status--compact .qf-prof-estado__btn{font-size:12px;min-height:36px;padding:7px 10px}',
   '#app-shell[data-route="profissional-home"] .qf-livre.qf-livre--compact{min-height:56px!important;padding:9px 12px!important;margin-bottom:12px!important}',
   '#app-shell[data-route="profissional-home"] .qf-livre--compact .qf-livre__icon{display:none}',
   '#app-shell[data-route="profissional-home"] .qf-livre--compact .qf-livre__copy strong{font-size:13px}',
   '#app-shell[data-route="profissional-home"] .qf-livre--compact .qf-livre__copy small{display:none}',
   '@media(max-width:360px){.qf-pedidos-tabs button{padding:11px 9px}.qf-pedidos-tab-title{font-size:12px}.qf-atd-values{font-size:11px;gap:5px 8px}.qf-atd-values>span+span{padding-left:8px}}',
   '.qf-pedidos-hint{margin:0 0 14px;line-height:1.5}',
   '.qf-home-job--fora{border-left:3px solid #edb275}',
   '.qf-pedidos-warning{background:#fff3e7;color:#81450d;border-radius:12px;padding:12px 14px;font-size:13px;margin-bottom:16px}',
   '.qf-home-jobs__header{display:flex;align-items:start;justify-content:space-between;gap:12px;margin-bottom:14px}',
   '.qf-home-jobs__header h2{font-size:23px;line-height:1.2;letter-spacing:-.025em}',
   '.qf-home-jobs__header p{margin-top:4px}',
   '.qf-home-jobs__header select{flex:none;width:auto;max-width:146px;padding:8px 12px;font-size:12px;border-radius:12px}',
   '.qf-home-job{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #e7edf4;border-radius:16px;padding:13px 12px;box-shadow:0 2px 8px rgba(5,36,84,.035)}',
   '.qf-home-job__symbol{display:grid;place-items:center;background:#ecf4ff;color:#125bb3;border-radius:13px;min-width:54px;height:60px}',
   '.qf-home-job__symbol svg{width:25px;height:25px}',
   '.qf-home-job__copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}',
   '.qf-home-job__copy strong{color:#0c2b58;font-size:14px;line-height:1.25;font-weight:800}',
   '.qf-home-job__copy small{color:#64748b;font-size:12px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
   '.qf-home-job__place{display:flex;align-items:center;gap:4px;color:#586780;font-size:12px}',
   '.qf-home-job__place svg{width:12px;height:12px;flex:none}',
   '.qf-home-job__badge{align-self:flex-start;font-size:10px;line-height:1.4;background:#eaf1fc;color:#2c4a80;border-radius:7px;padding:3px 7px;font-weight:800}',
   '.qf-home-job__badge.is-urgent{background:#f25757;color:#fff}',
   '.qf-home-job__action{flex:none;display:flex;flex-direction:column;align-items:stretch;gap:5px;width:100px;text-align:center}',
   '.qf-home-job__distance{font-size:13px;color:#1c396b;font-weight:800}',
   '.qf-home-job__action .btn{border-radius:10px;font-size:12px;padding:10px 8px;min-height:38px;margin:0}',
   '.qf-home-job__vagas{font-size:12px;color:#995109;background:#fff3e7;border-radius:9px;font-weight:700;padding:5px 4px}',
   '@media(max-width:400px){.qf-home-job{gap:8px;padding:10px 8px}.qf-home-job__symbol{min-width:39px;height:48px}.qf-home-job__action{min-width:78px}.qf-home-jobs__header{flex-wrap:wrap}}'
  ].join('\n');
  document.head.appendChild(tag);
})();
