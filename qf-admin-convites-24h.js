/* Quem Faz — convites individuais de 24 horas. Exclusivo do painel admin. */
(function(){
  'use strict';
  var mounted=null, lastLink='', lastEmail='', lastPhone='';
  var css='.qf-conv24{margin:0 0 20px;padding:20px;border:1px solid #e5e8ed;border-radius:18px;background:#fff;box-shadow:0 5px 22px rgba(20,37,56,.06)}.qf-conv24 h2{font-size:20px;margin:0 0 6px;color:#10243a}.qf-conv24 p{margin:0 0 14px;color:#566277;font-size:13px;line-height:1.55}.qf-conv24__fields{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:12px}.qf-conv24 input{width:100%;min-height:44px;border:1px solid #ccd5df;border-radius:11px;padding:10px 12px;font-size:14px}.qf-conv24 label{display:block;font-size:13px;font-weight:700;color:#263647}.qf-conv24 label input{margin-top:5px}.qf-conv24 button{min-height:40px;margin:10px 8px 0 0}.qf-conv24__out{margin-top:14px;padding:14px;background:#edf7f0;border-radius:12px;overflow-wrap:anywhere}.qf-conv24__list{margin-top:18px;border-top:1px solid #e9edf2;padding-top:12px}.qf-conv24__item{padding:10px 0;border-bottom:1px solid #edf0f3;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px}.qf-conv24__muted{color:#667487;font-size:12px}@media(max-width:600px){.qf-conv24{padding:14px}.qf-conv24__fields{grid-template-columns:1fr}.qf-conv24__item{align-items:flex-start;flex-direction:column}}';
  function escape(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  function client(){return window.QFAdminCloud&&window.QFAdminCloud.client}
  function isAdmin(){try{return window.DB&&window.DB.getSession&&window.DB.getSession().role==='admin'}catch(_){return false}}
  function route(){return location.hash.indexOf('#/admin/planos')===0}
  function date(s){if(!s)return '';try{return new Date(s).toLocaleString('pt-BR')}catch(_){return s}}
  function msg(){return 'Olá! Você recebeu um convite individual do Quem Faz Serviços para 24 horas de acesso. Abra o link e cadastre-se com o e-mail '+lastEmail+'. O acesso termina automaticamente 24 horas depois da ativação, sem cobrança automática.\n'+lastLink}
  function mount(){
    if(!route()||!isAdmin()||!client())return;
    var root=document.querySelector('#app-content .view');if(!root)return;
    if(root.querySelector('#qf-convites-24h'))return;
    if(!document.querySelector('#qf-conv24-style')){var st=document.createElement('style');st.id='qf-conv24-style';st.textContent=css;document.head.appendChild(st)}
    var card=document.createElement('section');card.className='qf-conv24';card.id='qf-convites-24h';
    card.innerHTML='<h2>Gerar link de teste — 24 horas</h2><p>Somente você emite convites. Cada link vale para <strong>um e-mail</strong> e pode ser usado uma vez. O link fica disponível para ativação por 7 dias; após ativar, o acesso dura exatamente 24 horas. Sem cobrança automática.</p>'+
      '<form id="qf-conv24-form"><div class="qf-conv24__fields"><label>E-mail do profissional<input name="email" type="email" autocomplete="off" placeholder="profissional@exemplo.com" required></label><label>WhatsApp com DDD (opcional)<input name="fone" type="tel" inputmode="tel" placeholder="(35) 99999-9999"></label></div><button class="btn btn--primary" type="submit">Gerar link exclusivo</button></form>'+
      '<div class="qf-conv24__out" id="qf-conv24-out" hidden></div><div id="qf-conv24-notice" role="status" class="qf-conv24__muted" style="margin-top:8px"></div><div class="qf-conv24__list"><strong>Últimos convites</strong><div id="qf-conv24-list" class="qf-conv24__muted">Carregando…</div></div>';
    root.insertBefore(card,root.firstChild);mounted=card;
    card.querySelector('#qf-conv24-form').addEventListener('submit',async function(e){
      e.preventDefault();var b=card.querySelector('button[type="submit"]'),note=card.querySelector('#qf-conv24-notice');
      b.disabled=true;note.textContent='Gerando convite…';
      try{
        var fd=new FormData(e.currentTarget);
        var response=await client().rpc('qf_admin_convite_24h_criar',{p_email:String(fd.get('email')||'').trim(),p_whatsapp:String(fd.get('fone')||'').trim()});
        if(response.error||!response.data||!response.data.ok)throw Error(response.error&&response.error.message||response.data&&response.data.error||'Não foi possível gerar.');
        lastLink=String(response.data.link||'');lastEmail=String(response.data.email||'');lastPhone=String(response.data.whatsapp||'');
        var out=card.querySelector('#qf-conv24-out');out.hidden=false;
        out.innerHTML='<strong>Convite gerado para '+escape(lastEmail)+'</strong><p style="margin:6px 0">Copie o link ou envie pelo WhatsApp. Ele será aceito apenas com esse e-mail.</p><input readonly id="qf-conv24-url" aria-label="Link de convite" value="'+escape(lastLink)+'">'+
          '<button type="button" class="btn btn--outline" data-conv24-copy>Copiar link</button>'+
          '<button type="button" class="btn btn--primary" data-conv24-whatsapp>Enviar pelo WhatsApp</button>';
        note.textContent='Convite gerado. Ainda não foi enviado automaticamente.';refresh();
      }catch(err){note.textContent=(err&&err.message)||'Erro ao gerar convite.'}
      finally{b.disabled=false}
    });
    card.addEventListener('click',async function(e){
      var copy=e.target.closest('[data-conv24-copy]'),wa=e.target.closest('[data-conv24-whatsapp]'),revoke=e.target.closest('[data-conv24-revogar]');
      if(copy&&lastLink){try{await navigator.clipboard.writeText(lastLink);card.querySelector('#qf-conv24-notice').textContent='Link copiado.'}catch(_){var field=card.querySelector('#qf-conv24-url');if(field){field.select();document.execCommand('copy')}}}
      if(wa&&lastLink){var num=lastPhone.replace(/\D/g,'');if(num&&num.length<=11)num='55'+num;window.open('https://wa.me/'+num+'?text='+encodeURIComponent(msg()),'_blank','noopener,noreferrer')}
      if(revoke){if(!confirm('Revogar este convite? Se o teste estiver ativo, o acesso será encerrado.'))return;revoke.disabled=true;try{var response=await client().rpc('qf_admin_convite_24h_revogar',{p_id:revoke.getAttribute('data-conv24-revogar')});if(response.error||!response.data||!response.data.ok)throw Error(response.error&&response.error.message||'Não foi possível revogar.');refresh()}catch(err){alert((err&&err.message)||'Erro ao revogar');revoke.disabled=false}}
    });
    refresh();
  }
  async function refresh(){
    var card=document.getElementById('qf-convites-24h'),box=card&&card.querySelector('#qf-conv24-list');
    if(!box||!client())return;
    try{
      var r=await client().rpc('qf_admin_convites_24h_listar');
      if(r.error||!r.data||!r.data.ok)throw Error('Não foi possível carregar os convites.');
      var rows=r.data.convites||[];
      box.innerHTML=rows.length?rows.map(function(x){
        var status=x.revogado_em?'Revogado':x.usado_em?(new Date(x.acesso_ate)>new Date()?'Acesso ativo até '+date(x.acesso_ate):'Teste encerrado'):(new Date(x.resgate_ate)>new Date()?'Aguardando uso':'Link vencido');
        return '<div class="qf-conv24__item"><div><strong>'+escape(x.email)+'</strong><div class="qf-conv24__muted">'+escape(status)+' · criado em '+escape(date(x.criado_em))+'</div></div>'+
           (!x.revogado_em?'<button class="btn btn--outline btn--sm" type="button" data-conv24-revogar="'+escape(x.id)+'">Revogar</button>':'')+'</div>';
      }).join(''):'Nenhum convite gerado.';
    }catch(err){box.textContent=(err&&err.message)||'Erro ao carregar convites.'}
  }
  var obs=new MutationObserver(function(){if(route()&&isAdmin())mount()});
  function start(){var host=document.getElementById('app-shell');if(host)obs.observe(host,{childList:true,subtree:true});mount();window.addEventListener('hashchange',function(){setTimeout(mount,100)})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();