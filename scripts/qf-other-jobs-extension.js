
// QF 12.1: vitrine somente-leitura de outras profissoes.
// Sem push, sem contato do cliente e sem botao de desbloqueio.
const qfOutrosState = { itens: [], userId: '', loadedAt: 0, pending: null };
function qfOutrosEsc(value) { return PU.escapeHtml(String(value == null ? '' : value)); }
function qfOutrosNum(value) { return Math.max(0, Number(value || 0) || 0); }
function qfOutrosCategoria(id) {
  const c = DB.categoryById(id);
  return c ? c.nome : String(id || 'Serviço').replace(/^cat_/, '').replace(/_/g, ' ');
}
function qfOutrosData(value) {
  if (!value) return 'A combinar';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return 'A combinar';
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
}
function qfOutrosHoraLocal() {
  try { return new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()); }
  catch (_) { return ''; }
}
function qfOutrosTab(extra, active) {
  const base = 'btn btn--outline';
  return '<button type="button" class="' + base + (active ? ' is-active' : '') +
    ' qf-outros-tab" data-nav="/profissional/outros-pedidos">' + icon('users') +
    ' Outros pedidos <span class="qf-outros-tab-count" data-qf-outros-count>' +
    (qfOutrosState.loadedAt ? qfOutrosNum(qfOutrosState.itens.length) : '...') + '</span></button>';
}
function qfOutrosTabs(active) {
  return '<div class="qf-services-tabs qf-outros-tabs">' +
    '<button type="button" class="btn btn--outline' + (active === 'meus' ? ' is-active' : '') +
    '" data-nav="/profissional/servicos">Meus serviços</button>' +
    '<button type="button" class="btn btn--outline' + (active === 'disponiveis' ? ' is-active' : '') +
    '" data-nav="/profissional/servicos/disponiveis">Perto de você</button>' +
    qfOutrosTab(false, active === 'outros') + '</div>';
}
function qfOutrosHomeCard(user) {
  const list = DB.chamadasPendentes(user.id).filter(function (r) { return !r.abertoTodos; });
  return '<div class="section qf-outros-home-section" aria-label="Listas de pedidos">' +
    '<div class="qf-outros-home-grid">' +
    '<button type="button" class="qf-outros-home-card qf-outros-home-card--mine" data-nav="/profissional/servicos/disponiveis">' +
    '<span class="qf-outros-home-card__top">' + icon('briefcase') + '<b>' + list.length + '</b></span>' +
    '<strong>Para você</strong><small>Profissão e região cadastradas</small></button>' +
    '<button type="button" class="qf-outros-home-card qf-outros-home-card--other" data-nav="/profissional/outros-pedidos">' +
    '<span class="qf-outros-home-card__top">' + icon('users') +
    '<b data-qf-outros-count>' + (qfOutrosState.loadedAt ? qfOutrosState.itens.length : '...') + '</b></span>' +
    '<strong>Outros pedidos</strong><small>Veja o movimento do Quem Faz</small></button>' +
    '</div><p class="qf-outros-home-note">Outras profissões aparecem apenas para consulta, sem notificações.</p></div>';
}
function qfOutrosStatusBadge(item) {
  const vagas = qfOutrosNum(item.vagas);
  return '<span class="qf-outros-vagas">' + vagas + (vagas === 1 ? ' vaga' : ' vagas') + '</span>';
}
function qfOutrosCard(item) {
  const cat = qfOutrosCategoria(item.categoria);
  const cidade = [item.cidade,item.uf].filter(Boolean).join(' - ');
  const local = [item.bairro,cidade].filter(Boolean).join(' · ');
  const cabecalho = item.titulo || cat;
  const id = qfOutrosEsc(item.id);
  const searchable = qfOutrosEsc([cat,cabecalho,local].join(' ').toLowerCase());
  return '<article class="qf-outros-request" data-qf-outros-card data-search="' + searchable + '">' +
    '<div class="qf-outros-request__top"><span class="qf-outros-icon">' + icon('briefcase') + '</span>' +
    '<div class="qf-outros-request__main"><strong>' + qfOutrosEsc(cabecalho) + '</strong>' +
    '<span class="qf-outros-request__place">' + icon('mapPin') + ' ' + qfOutrosEsc(cidade) + '</span>' +
    '<small>' + qfOutrosEsc(cat) + '</small></div>' +
    '<div class="qf-outros-request__right">' + qfOutrosStatusBadge(item) + '</div></div>' +
    '<div class="qf-outros-request__bottom"><span class="qf-outros-request__date">' +
    qfOutrosEsc(item.data_preferida ? 'Previsto: ' + qfOutrosData(item.data_preferida) : 'Data a combinar') +
    '</span><button type="button" class="btn btn--outline btn--sm" data-qf-outros-ver="' + id +
    '" aria-expanded="false">Ver pedido ' + icon('chevronDown') + '</button></div>' +
    '<div class="qf-outros-request__details" data-qf-outros-detalhe="' + id + '" hidden>' +
    '<p><strong>Região:</strong> ' + qfOutrosEsc(local || cidade) + '</p>' +
    '<p><strong>Vagas disponíveis:</strong> ' + qfOutrosNum(item.vagas) + ' de ' + qfOutrosNum(item.limite) + '</p>' +
    '<p>Este serviço pertence a outra profissão. Para receber chamadas desta categoria, cadastre-a somente se você realmente a realiza. A região de atendimento também deve ser compatível.</p>' +
    '<button type="button" class="btn btn--outline btn--sm" data-nav="/profissional/home">Voltar ao início e ajustar profissões</button>' +
    '</div></article>';
}
function qfOutrosListHtml(itens) {
  return itens.length ? itens.map(qfOutrosCard).join('') :
    '<div class="empty-state qf-outros-empty"><div class="icon-tile icon-tile--ghost">' +
    icon('search') + '</div><strong>Nenhum outro pedido aberto agora.</strong>' +
    '<p class="text--sm text--secondary">Quando surgirem oportunidades de outras profissões, elas aparecerão aqui.</p></div>';
}
Screens.profOutrosPedidosRender = function () {
  return '<div class="view qf-outros-view">' + qfOutrosTabs('outros') +
    '<div class="qf-outros-banner">' + icon('users') +
    '<div><strong>Outras oportunidades no Quem Faz</strong>' +
    '<p>Pedidos reais de outras profissões que ainda têm vagas. Consulte sem receber notificações; ' +
    'somente profissionais habilitados para cada serviço podem atender.</p></div></div>' +
    '<div class="section qf-outros-section"><div class="row-between qf-outros-heading">' +
    '<div><h2 class="h3">Outros pedidos <span class="badge badge--orange" data-qf-outros-count>' +
    (qfOutrosState.loadedAt ? qfOutrosState.itens.length : '...') +
    '</span></h2><p class="text--sm text--secondary">Atividade de outras categorias em todo o Quem Faz.</p></div>' +
    '<button type="button" class="btn btn--outline btn--sm" data-qf-outros-atualizar>' + icon('refresh') + ' Atualizar</button>' +
    '</div><input class="input qf-outros-search" type="search" data-qf-outros-busca placeholder="Buscar serviço ou cidade" aria-label="Buscar outros pedidos">' +
    '<div class="stack--sm" data-qf-outros-lista><p class="text--sm text--muted">Carregando pedidos disponíveis...</p></div>' +
    '<p class="qf-outros-safety">Sem notificações nesta aba. Não há acesso ao contato ou endereço exato do cliente. Pedidos encerrados e sem vagas não aparecem.</p>' +
    '</div></div>';
};
const qfOutrosHomeRender = Screens.profHomeRender;
Screens.profHomeRender = function(params,user) {
  const html = qfOutrosHomeRender(params,user);
  const anchor = '<div class="section" id="chamados-disponiveis">';
  return html.includes(anchor) ? html.replace(anchor,qfOutrosHomeCard(user) + anchor) : html;
};
function qfOutrosAddTab(original) {
  return original.replace(/<div class="qf-services-tabs">([\s\S]*?)<\/div>/,function(all,inside) {
    return '<div class="qf-services-tabs">' + inside + qfOutrosTab(false,false) + '</div>';
  });
}
const qfOutrosServicosRender = Screens.profServicosRender;
Screens.profServicosRender = function(params,user) {
  return qfOutrosAddTab(qfOutrosServicosRender(params,user));
};
const qfOutrosDisponiveisRender = Screens.profServicosDisponiveisRender;
Screens.profServicosDisponiveisRender = function(params,user) {
  return qfOutrosAddTab(qfOutrosDisponiveisRender(params,user));
};
async function qfOutrosLoad(user,force) {
  if (!user || !user.id) return [];
  if (qfOutrosState.userId !== user.id) {
    qfOutrosState.userId=user.id;
    qfOutrosState.itens=[];
    qfOutrosState.loadedAt=0;
    qfOutrosState.pending=null;
  }
  if (!force && qfOutrosState.loadedAt && Date.now()-qfOutrosState.loadedAt<20000) return qfOutrosState.itens;
  if (qfOutrosState.pending) return qfOutrosState.pending;
  const cloud = global.QFCloud;
  if (!cloud || !cloud.client) throw new Error('Conecte-se para consultar os pedidos.');
  const expectedUser=user.id;
  qfOutrosState.pending=cloud.client.rpc('qf_outros_pedidos_vitrine').then(function(res) {
    if (res.error) throw res.error;
    const rows=(Array.isArray(res.data)?res.data:[]).filter(function(r) {
      return r && r.id && qfOutrosNum(r.vagas)>0;
    });
    if (qfOutrosState.userId===expectedUser) {
      qfOutrosState.itens=rows;
      qfOutrosState.loadedAt=Date.now();
    }
    return rows;
  }).finally(function(){ if (qfOutrosState.userId===expectedUser) qfOutrosState.pending=null; });
  return qfOutrosState.pending;
}
function qfOutrosFiltrar(content) {
  const campo=content.querySelector('[data-qf-outros-busca]');
  const valor=(campo&&campo.value||'').toLocaleLowerCase('pt-BR').trim();
  Array.prototype.forEach.call(content.querySelectorAll('[data-qf-outros-card]'),function(card) {
    card.hidden=!!valor && !String(card.getAttribute('data-search')||'').toLocaleLowerCase('pt-BR').includes(valor);
  });
}
function qfOutrosAtualizarTela(pattern,content,user,force) {
  qfOutrosLoad(user,force).then(function(rows) {
    if (!document.body.contains(content) || (global.DB.getSession()||{}).userId!==user.id) return;
    Array.prototype.forEach.call(content.querySelectorAll('[data-qf-outros-count]'),function(n){ n.textContent=String(rows.length); });
    if (pattern==='/profissional/outros-pedidos') {
      const lista=content.querySelector('[data-qf-outros-lista]');
      if(lista){lista.innerHTML=qfOutrosListHtml(rows);qfOutrosFiltrar(content);}
    }
  }).catch(function(err){
    if (!document.body.contains(content)) return;
    const lista=content.querySelector('[data-qf-outros-lista]');
    if (lista) lista.innerHTML='<div class="card"><p class="text--sm text--secondary">Não foi possível carregar os pedidos agora. Tente novamente.</p></div>';
    console.warn('Quem Faz outros pedidos',err);
  });
}
const qfOutrosAfterRender = Screens.afterRender;
Screens.afterRender = function(pattern,content,params,user){
  if (qfOutrosAfterRender) qfOutrosAfterRender(pattern,content,params,user);
  if (!user || !user.id) return;
  if (pattern==='/profissional/home' || pattern==='/profissional/servicos' ||
      pattern==='/profissional/servicos/disponiveis' || pattern==='/profissional/outros-pedidos') {
    qfOutrosAtualizarTela(pattern,content,user,pattern==='/profissional/outros-pedidos');
  }
  if (pattern==='/profissional/outros-pedidos') {
    content.addEventListener('input',function(e){ if(e.target.closest('[data-qf-outros-busca]'))qfOutrosFiltrar(content); });
    content.addEventListener('click',function(e){
      const update=e.target.closest('[data-qf-outros-atualizar]');
      if(update){update.disabled=true;qfOutrosAtualizarTela(pattern,content,user,true);setTimeout(function(){if(document.body.contains(update))update.disabled=false;},1300);return;}
      const btn=e.target.closest('[data-qf-outros-ver]');
      if(!btn)return;
      const id=btn.getAttribute('data-qf-outros-ver');
      const pane=Array.prototype.find.call(content.querySelectorAll('[data-qf-outros-detalhe]'),function(v){return v.getAttribute('data-qf-outros-detalhe')===id;});
      if(!pane)return;
      pane.hidden=!pane.hidden;
      btn.setAttribute('aria-expanded',pane.hidden?'false':'true');
      btn.innerHTML=pane.hidden?'Ver pedido '+icon('chevronDown'):'Fechar detalhes '+icon('chevronUp');
    });
  }
};
(function qfOutrosStyles(){
  if(document.getElementById('qf-outros-style'))return;
  const tag=document.createElement('style');
  tag.id='qf-outros-style';
  tag.textContent=[
   '.qf-outros-home-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
   '.qf-outros-home-card{border:1.5px solid #cbd9ee;border-radius:18px;background:linear-gradient(160deg,#fff,#f3f7ff);padding:16px 13px;display:flex;flex-direction:column;gap:5px;align-items:flex-start;text-align:left;min-height:142px;color:#0c2a57;cursor:pointer}',
   '.qf-outros-home-card--other{border-color:#ff9d5c;background:linear-gradient(145deg,#fff,#fff1e5)}',
   '.qf-outros-home-card__top{width:100%;display:flex;align-items:center;justify-content:space-between;color:#0b58ca}',
   '.qf-outros-home-card--other .qf-outros-home-card__top{color:#f26a00}',
   '.qf-outros-home-card__top svg{width:26px;height:26px}',
   '.qf-outros-home-card__top b{border-radius:9px;background:#075ddd;color:white;font-size:13px;padding:4px 9px}',
   '.qf-outros-home-card--other b{background:#fb7508}',
   '.qf-outros-home-card strong{font-size:15px;font-weight:800}',
   '.qf-outros-home-card small{font-size:12px;line-height:1.4;color:#52647d}',
   '.qf-outros-home-note{font-size:12px;color:#66748d;margin:9px 0 0}',
   '.qf-services-tabs:has(.qf-outros-tab){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}',
   '.qf-services-tabs .qf-outros-tab,.qf-services-tabs:has(.qf-outros-tab)>.btn{min-width:0;white-space:normal;padding:10px 5px;font-size:12px;line-height:1.25;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:3px;text-align:center}',
   '.qf-outros-tab svg{width:15px;height:15px}',
   '.qf-outros-tab-count{background:#f9760d;color:#fff;border-radius:999px;padding:1px 6px;font-size:11px;font-weight:800}',
   '.qf-outros-banner{background:#fff2e8;border:1px solid #ffdfc6;border-radius:16px;padding:15px;display:flex;gap:12px;color:#94380a;margin:4px 0 16px}',
   '.qf-outros-banner>svg{flex:none;width:26px;height:26px;color:#f9770b}',
   '.qf-outros-banner strong{font-weight:800;font-size:15px}',
   '.qf-outros-banner p{font-size:13px;line-height:1.55;margin:4px 0 0;color:#774d35}',
   '.qf-outros-heading{gap:10px;align-items:center;flex-wrap:wrap}',
   '.qf-outros-heading>.btn{flex:none}',
   '.qf-outros-search{margin:10px 0 13px}',
   '.qf-outros-request{background:#fff;border:1px solid #e4e9f1;box-shadow:0 2px 12px rgba(5,31,80,.045);border-radius:16px;padding:13px 13px 11px}',
   '.qf-outros-request[hidden]{display:none!important}',
   '.qf-outros-request__top{display:flex;gap:10px;align-items:flex-start}',
   '.qf-outros-icon{border-radius:12px;background:#e8f1fd;color:#0e51b4;width:44px;height:44px;flex:none;display:grid;place-items:center}',
   '.qf-outros-icon svg{width:22px;height:22px}',
   '.qf-outros-request__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
   '.qf-outros-request__main strong{font-weight:800;color:#0d2853;font-size:15px}',
   '.qf-outros-request__main small,.qf-outros-request__place{font-size:12px;color:#65728a}',
   '.qf-outros-request__place svg{width:12px;height:12px;vertical-align:middle}',
   '.qf-outros-request__right{flex:none}',
   '.qf-outros-vagas{background:#fff1df;color:#a64a0b;border-radius:100px;font-size:12px;padding:5px 9px;font-weight:750;white-space:nowrap}',
   '.qf-outros-request__bottom{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid #edf0f4;margin-top:11px;padding-top:10px}',
   '.qf-outros-request__date{font-size:12px;color:#5f6f86}',
   '.qf-outros-request__bottom .btn{background:#ff760b;border-color:#ff760b;color:#fff;font-weight:750;border-radius:12px}',
   '.qf-outros-request__details{border-top:1px dashed #e0e5ee;margin-top:10px;padding-top:10px;font-size:13px;line-height:1.5;color:#465774}',
   '.qf-outros-request__details p{margin:4px 0 9px}',
   '.qf-outros-request__details[hidden]{display:none!important}',
   '.qf-outros-safety{font-size:12px;color:#66748d;margin-top:15px;line-height:1.55}',
   '@media(min-width:700px){.qf-outros-home-grid{max-width:640px}.qf-outros-view{max-width:850px;margin:auto}}'
  ].join('\n');
  document.head.appendChild(tag);
})();
