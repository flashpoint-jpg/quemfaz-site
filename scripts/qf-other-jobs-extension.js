// Pedidos do profissional: somente a lista elegível do servidor (profissão + raio).
// Links antigos de Outros pedidos abrem a mesma lista, sem consultar a vitrine.
function qfOutrosEsc(value) { return PU.escapeHtml(String(value == null ? '' : value)); }
Screens.profOutrosPedidosRender = function(params,user) {
  return Screens.profServicosDisponiveisRender(params,user);
};
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
  const place=String((city&&city.nome)||((req.endereco||{}).cidade)||'Região informada');
  const uf=String((city&&city.uf)||((req.endereco||{}).uf)||'');
  const category=(c&&c.nome)||'Serviço';
  const title=qfOutrosEsc(category);
  // Urgente (grátis) vira etiqueta vermelha; Normal aparece discreto; prioridade paga tem selo próprio.
  const U=window.QFUrgencia;
  const tags=U?(U.tagHtml(req)+U.prioridadeHtml(req)):(req.prioridade?'<span class="qf-home-job__badge is-urgent">URGENTE</span>':'');
  const msg=window.QFPedidoMsg?window.QFPedidoMsg.html(req):'';
  const dist=req.distanciaKm==null||!Number.isFinite(Number(req.distanciaKm))?'':qfOutrosEsc(Number(req.distanciaKm).toLocaleString('pt-BR',{maximumFractionDigits:1})+' km');
  const limit=Math.max(1,Number(req.limiteParticipantes||req.maxOrcamentos||3)||3);
  const occupied=Math.max(0,Number(req.participantes||0)||0);
  const free=Math.max(0,limit-occupied);
  return '<article class="qf-home-job" data-qf-home-job data-created="'+qfOutrosEsc(req.criadoEm||'')+
    '" data-distance="'+(req.distanciaKm==null?'999999':Number(req.distanciaKm))+'">'+
    '<div class="qf-home-job__symbol">'+icon(c&&c.icon||'briefcase')+'</div>'+
    '<div class="qf-home-job__copy"><span style="display:flex;gap:6px;flex-wrap:wrap;align-self:flex-start">'+tags+'</span>'+
    '<strong>'+title+'</strong><span class="qf-home-job__place">'+icon('mapPin')+' '+qfOutrosEsc(place+(uf?' - '+uf:''))+'</span>'+
    '<small>'+qfOutrosEsc(String(req.descricao||'').slice(0,85))+'</small>'+msg+'</div>'+
    '<div class="qf-home-job__action">'+(dist?'<span class="qf-home-job__distance">'+dist+'</span>':'')+
    '<button class="btn btn--primary" type="button" data-nav="/profissional/chamada/'+qfOutrosEsc(req.id)+'">Ver pedido</button>'+
    '<span class="qf-home-job__vagas">'+free+(free===1?' vaga':' vagas')+'</span></div></article>';
}
function qfOutrosHomePedidos(user) {
  const rows=DB.chamadasPendentes(user.id).filter(function(r){return !r.abertoTodos&&r.profissionalId==null;});
  rows.sort(function(a,b){
    const d=Number(a.distanciaKm),e=Number(b.distanciaKm);
    if(a.prioridade!==b.prioridade)return a.prioridade?-1:1;
    if(Number.isFinite(d)&&Number.isFinite(e)&&d!==e)return d-e;
    return String(b.criadoEm||'').localeCompare(String(a.criadoEm||''));
  });
  return '<div class="section qf-home-jobs" id="chamados-disponiveis">'+
    '<div class="qf-home-jobs__header"><div><h2 class="h3">Pedidos para você <span class="badge badge--orange">'+rows.length+'</span></h2>'+
    '<p class="text--sm text--secondary">Da sua profissão e região de atendimento.</p></div>'+
    (rows.length>1?'<select class="select" data-qf-home-sort aria-label="Ordenar pedidos">'+
      '<option value="closest">Mais próximos</option><option value="recent">Mais recentes</option></select>':'')+'</div>'+
    (rows.length?'<div class="stack--sm" data-qf-home-list>'+rows.map(qfOutrosProCard).join('')+'</div>':
      '<div class="empty-state"><div class="icon-tile icon-tile--ghost">'+icon('search')+'</div>'+
      '<p class="text text--secondary">Nenhum pedido da sua profissão dentro do seu raio agora. Avisaremos quando chegar um novo.</p></div>')+
    '</div>';
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
  const status=holder.querySelector('.qf-prof-estado__msg');
  const update=qfOutrosHorario(user);
  if(status&&update)status.textContent=update;
  return holder.innerHTML;
};
const qfOutrosDisponiveisRender = Screens.profServicosDisponiveisRender;
Screens.profServicosDisponiveisRender = function(params,user) {
  const holder=document.createElement('div');
  holder.innerHTML=qfOutrosDisponiveisRender(params,user);
  const legacy=holder.querySelector('.qf-abertos');
  if(legacy)legacy.remove();
  return holder.innerHTML;
};
const qfOutrosAfterRender = Screens.afterRender;
Screens.afterRender = function(pattern,content,params,user){
  if (qfOutrosAfterRender) qfOutrosAfterRender(pattern,content,params,user);
  if (!user || !user.id) return;
  if (pattern==='/profissional/home') {
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
   '.qf-home-job__action{flex:none;display:flex;flex-direction:column;align-items:stretch;gap:5px;min-width:85px;text-align:center}',
   '.qf-home-job__distance{font-size:13px;color:#1c396b;font-weight:800}',
   '.qf-home-job__action .btn{border-radius:10px;font-size:12px;padding:10px 8px;min-height:38px;margin:0}',
   '.qf-home-job__vagas{font-size:12px;color:#995109;background:#fff3e7;border-radius:9px;font-weight:700;padding:5px 4px}',
   '@media(max-width:400px){.qf-home-job{gap:8px;padding:10px 8px}.qf-home-job__symbol{min-width:39px;height:48px}.qf-home-job__action{min-width:78px}.qf-home-jobs__header{flex-wrap:wrap}}'
  ].join('\n');
  document.head.appendChild(tag);
})();
