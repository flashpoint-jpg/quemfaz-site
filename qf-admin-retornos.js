/* Quem Faz Admin — contatos salvos de clientes e profissionais para retomar depois. */
(function(){
'use strict';
var rows=[], current='pendente',lastLoaded=0;
var styles='.qf-retorno{padding:12px 0}.qf-retorno h2{font-size:23px;margin:4px 0;color:#15263e}.qf-retorno p{color:#637185;font-size:14px;line-height:1.5}.qf-retorno-tabs{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.qf-retorno-tabs button{border-radius:12px;border:1px solid #cbd6e1;padding:10px 12px;background:#fff;color:#21476d;font-weight:700;min-height:43px;cursor:pointer}.qf-retorno-tabs button[aria-pressed="true"]{background:#1458cc;color:#fff;border-color:#1458cc}.qf-retorno-card{padding:16px;border:1px solid #e0e7ef;border-radius:16px;background:#fff;margin:12px 0;box-shadow:0 4px 20px rgba(14,37,67,.045)}.qf-retorno-head{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;flex-wrap:wrap}.qf-retorno-head strong{color:#18314e;font-size:17px}.qf-retorno-tag{font-size:12px;padding:5px 9px;border-radius:20px;background:#eef4fb;color:#235185;font-weight:800}.qf-retorno-sub{color:#657487;font-size:12px;margin:4px 0 10px}.qf-retorno-obs{padding:10px;background:#f6f8fb;border-radius:10px;color:#405065;margin:8px 0;font-size:13px;overflow-wrap:anywhere}.qf-retorno-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.qf-retorno-wa{display:inline-flex;align-items:center;justify-content:center;background:#0f864a;color:#fff;border-radius:11px;text-decoration:none;padding:10px 14px;font-weight:750;min-height:42px}.qf-retorno-actions select{min-height:42px;min-width:160px;padding:9px 12px;border:1px solid #c6d3e1;border-radius:10px;background:#fff;color:#223448}.qf-retorno-empty{text-align:center;background:#f5f8fb;padding:26px;border-radius:14px;margin:16px 0}.qf-retorno-load{font-size:13px;color:#52708e}';
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function admin(){try{return window.DB&&window.DB.getSession&&window.DB.getSession().role==='admin'}catch(_){return false}}
function client(){return window.QFAdminCloud&&window.QFAdminCloud.client}
function onRoute(){return (location.hash||'').indexOf('#/admin/retornos')===0}
function when(q){return q==='amanha'?'Amanhã':q==='semana_que_vem'?'Próxima semana':'Quando puder'}
function date(v){try{return new Date(v).toLocaleString('pt-BR')}catch(_){return ''}}
function mount(){
 if(!onRoute()||!admin()||!client())return;
 var r=document.querySelector('#app-content [data-qf-retornos]');if(!r||r.dataset.ready==='1')return;
 r.dataset.ready='1';
 if(!document.getElementById('qf-retorno-style')){var s=document.createElement('style');s.id='qf-retorno-style';s.textContent=styles;document.head.appendChild(s)}
 r.innerHTML='<section class="qf-retorno"><h2>Contatos para retornar</h2>'+
  '<p>Pessoas que pediram para guardar o contato e continuar o cadastro ou pedido mais tarde. WhatsApp abre uma conversa; nenhuma mensagem é enviada automaticamente.</p>'+
  '<details class="qf-retorno-card"><summary style="font-weight:800;cursor:pointer;color:#1458cc">Adicionar contato que chamou no WhatsApp</summary>'+
  '<p class="qf-retorno-sub">Registre uma pessoa que pediu expressamente para guardar o contato e voltar depois.</p>'+
  '<form id="qf-retorno-manual" class="stack" style="margin-top:12px">'+
  '<label class="field"><span class="field__label">Tipo</span><select class="select" name="tipo" required><option value="profissional">Profissional</option><option value="cliente">Cliente</option></select></label>'+
  '<label class="field"><span class="field__label">Nome</span><input class="input" name="nome" required minlength="2" maxlength="120" placeholder="Nome informado no WhatsApp"></label>'+
  '<label class="field"><span class="field__label">WhatsApp com DDD</span><input class="input" name="whatsapp" required inputmode="tel" type="tel" placeholder="(11) 99999-9999"></label>'+
  '<label class="field"><span class="field__label">E-mail (se souber)</span><input class="input" name="email" type="email" maxlength="160"></label>'+
  '<label class="field"><span class="field__label">Quando pretende voltar?</span><select class="select" name="quando"><option value="semana_que_vem">Próxima semana</option><option value="amanha">Amanhã</option><option value="quando_puder">Ainda não sabe</option></select></label>'+
  '<label class="field"><span class="field__label">Observação</span><input class="input" name="obs" maxlength="350" placeholder="Ex.: vai pagar na próxima semana"></label>'+
  '<label style="display:flex;align-items:center;gap:8px;font-size:13px"><input type="checkbox" name="autorizado" required> A pessoa pediu para guardar o contato.</label>'+
  '<button class="btn btn--primary" type="submit">Salvar contato no painel</button><div id="qf-retorno-erro" role="status" class="qf-retorno-sub"></div></form></details>'+
  '<div class="qf-retorno-tabs" role="group" aria-label="Filtrar interessados"><button type="button" data-retorno-filter="pendente" aria-pressed="true">Pendentes</button><button type="button" data-retorno-filter="profissional" aria-pressed="false">Profissionais</button><button type="button" data-retorno-filter="cliente" aria-pressed="false">Clientes</button><button type="button" data-retorno-filter="todos" aria-pressed="false">Todos</button></div>'+
  '<div id="qf-retorno-state" class="qf-retorno-load">Carregando contatos...</div><div id="qf-retorno-list"></div>'+
  '</section>';
 r.addEventListener('click',function(ev){var b=ev.target.closest('[data-retorno-filter]');if(!b)return;current=b.dataset.retornoFilter;render()});
 r.addEventListener('submit',async function(ev){
  var f=ev.target.closest('#qf-retorno-manual');if(!f)return;ev.preventDefault();
  var fd=new FormData(f),b=f.querySelector('[type="submit"]'),msg=f.querySelector('#qf-retorno-erro');
  if(!f.querySelector('[name="autorizado"]').checked){msg.textContent='Confirme a autorização da pessoa.';return}
  b.disabled=true;msg.textContent='Salvando...';
  try{
   var res=await client().rpc('qf_retorno_salvar',{
    p_tipo:String(fd.get('tipo')||''),p_nome:String(fd.get('nome')||''),
    p_whatsapp:String(fd.get('whatsapp')||''),p_email:String(fd.get('email')||''),
    p_proximo_contato:String(fd.get('quando')||'semana_que_vem'),
    p_observacao:String(fd.get('obs')||''),p_consent:true
   });
   if(res.error||!res.data||!res.data.ok)throw Error(res.error&&res.error.message||res.data&&res.data.error||'Não foi possível salvar.');
   f.reset();msg.textContent='Contato salvo. Já está na lista.';current='pendente';await load();
  }catch(e){msg.textContent=e.message||'Não foi possível salvar.'}
  finally{b.disabled=false}
 });
 r.addEventListener('change',async function(ev){
  var sel=ev.target.closest('[data-retorno-status]');if(!sel)return;
  var id=sel.dataset.retornoStatus,st=sel.value;sel.disabled=true;
  try{
   var res=await client().rpc('qf_admin_retorno_atualizar',{p_id:id,p_status:st});
   if(res.error||!res.data||!res.data.ok)throw Error(res.error&&res.error.message||'Não foi possível atualizar');
   var row=rows.find(function(x){return x.id===id});if(row)row.status=st;
   render();
  }catch(e){alert(e.message||'Erro ao atualizar');sel.disabled=false;render()}
 });
 load();
}
async function load(){
 var container=document.querySelector('#app-content [data-qf-retornos]');if(!container||!onRoute()||!client())return;
 var status=container.querySelector('#qf-retorno-state');if(status)status.textContent='Carregando contatos...';
 try{
  var res=await client().rpc('qf_admin_retornos_listar',{p_tipo:'todos'});
  if(res.error||!res.data||!res.data.ok)throw Error(res.error&&res.error.message||res.data&&res.data.error||'Sem acesso.');
  rows=Array.isArray(res.data.contatos)?res.data.contatos:[];
  lastLoaded=Date.now();render();
 }catch(e){if(status)status.textContent='Falha ao carregar: '+String(e.message||e)}
}
function render(){
 var box=document.querySelector('#app-content [data-qf-retornos]');if(!box)return;
 box.querySelectorAll('[data-retorno-filter]').forEach(function(b){b.setAttribute('aria-pressed',b.dataset.retornoFilter===current?'true':'false')});
 var pend=rows.filter(function(x){return x.status==='pendente'}).length;
 var st=box.querySelector('#qf-retorno-state');if(st)st.textContent=pend+' pendente(s) para retorno · '+rows.length+' contato(s) salvos';
 var matches=rows.filter(function(x){return current==='todos'||(current==='pendente'?x.status==='pendente':x.tipo===current)});
 var list=box.querySelector('#qf-retorno-list');
 if(!matches.length){list.innerHTML='<div class="qf-retorno-empty">Nenhum contato nesta seleção.</div>';return}
 list.innerHTML=matches.map(function(x){
  var phone=String(x.whatsapp||'').replace(/[^0-9]/g,'');
  var msg=x.tipo==='profissional'
   ?'Olá, '+String(x.nome||'')+'! Aqui é do Quem Faz Serviços. Você pediu para guardarmos seu contato e retomar seu cadastro quando pudesse. Quer continuar? https://quemfazservico.com.br/#/auth/profissional/cadastro'
   :'Olá, '+String(x.nome||'')+'! Aqui é do Quem Faz Serviços. Você pediu para guardarmos seu contato. Se ainda precisa de um profissional, pode publicar seu pedido grátis: https://quemfazservico.com.br/#/auth/cliente/cadastro';
  var wa='https://wa.me/'+(phone.indexOf('55')===0?phone:'55'+phone)+'?text='+encodeURIComponent(msg);
  return '<article class="qf-retorno-card"><div class="qf-retorno-head"><div><strong>'+esc(x.nome)+'</strong><div class="qf-retorno-sub">'+esc(x.whatsapp)+(x.email?' · '+esc(x.email):'')+'</div></div><span class="qf-retorno-tag">'+(x.tipo==='profissional'?'Profissional':'Cliente')+'</span></div>'+
  '<div class="qf-retorno-sub">Salvo '+esc(date(x.criado_em))+' · Pretende voltar: '+esc(when(x.proximo_contato))+'</div>'+
  (x.observacao?'<div class="qf-retorno-obs">'+esc(x.observacao)+'</div>':'')+
  '<div class="qf-retorno-actions"><a class="qf-retorno-wa" href="'+esc(wa)+'" target="_blank" rel="noopener noreferrer">Chamar no WhatsApp</a>'+
  '<label class="text--sm">Situação <select aria-label="Situação do contato '+esc(x.nome)+'" data-retorno-status="'+esc(x.id)+'">'+
  [['pendente','Pendente'],['contatado','Contatado'],['concluido','Concluído'],['descartado','Descartado']].map(function(p){return '<option value="'+p[0]+'"'+(x.status===p[0]?' selected':'')+'>'+p[1]+'</option>'}).join('')+
  '</select></label></div></article>';
 }).join('');
}
var timer=null;
function start(){var host=document.getElementById('app-shell');if(host)new MutationObserver(function(){if(onRoute()&&admin())mount()}).observe(host,{childList:true,subtree:false});window.addEventListener('hashchange',function(){clearTimeout(timer);timer=setTimeout(mount,100)});mount()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();