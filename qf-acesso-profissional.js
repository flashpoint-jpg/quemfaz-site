/* QuemFaz — monitoramento de acesso dos profissionais (app Android, PWA instalado, navegador).
   Só roda com profissional autenticado. Não pede permissões, não altera pagamentos, créditos,
   chamados, raio nem desbloqueios. Um user-agent sozinho NÃO prova instalação: o que não tem
   confirmação técnica é gravado como "inferida" (estimativa) e aparece assim no painel. */
(function (global) {
  'use strict';
  var CHAVE = 'qf_acesso_prof_ultimo';
  var INTERVALO_MS = 30 * 60 * 1000;
  var emAndamento = false;

  function nativo() {
    var C = global.Capacitor;
    try { return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (_) { return false; }
  }

  function standalone() {
    try {
      var mm = global.matchMedia;
      if (mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches || mm('(display-mode: minimal-ui)').matches)) return true;
    } catch (_) {}
    return !!(global.navigator && global.navigator.standalone === true);
  }

  // Retorna { tipo_acesso, confianca, evidencia, app_versao }.
  function detectarTipoAcesso() {
    var versao = null;
    try { versao = localStorage.getItem('qf_apk_version') || null; } catch (_) {}
    // Ponte nativa do aplicativo Android (Capacitor): confirmação técnica de que é o app.
    // A origem da instalação (Play Store x APK avulso) não é verificável pelo site.
    if (nativo()) return { tipo_acesso: 'play_store', confianca: 'confirmada', evidencia: 'capacitor_nativo', app_versao: versao };
    var s = standalone();
    var plataforma = null;
    try { plataforma = localStorage.getItem('qf_platform'); } catch (_) {}
    // Trusted Web Activity abre com ?source=twa; é um parâmetro de URL, portanto só estimativa.
    if (s && plataforma === 'android') return { tipo_acesso: 'play_store', confianca: 'inferida', evidencia: 'twa_parametro_url', app_versao: versao };
    if (s) return { tipo_acesso: 'pwa', confianca: 'inferida', evidencia: 'display_mode_standalone', app_versao: null };
    if (global.matchMedia || global.navigator) return { tipo_acesso: 'navegador', confianca: 'inferida', evidencia: 'display_mode_browser', app_versao: null };
    return { tipo_acesso: 'desconhecido', confianca: 'inferida', evidencia: 'sem_sinais', app_versao: null };
  }

  function estadoNotificacoes() {
    var perm = null, ativo = null;
    try {
      var P = global.QFPush;
      if (P && typeof P.permission === 'function') perm = P.permission();
      else if (typeof Notification !== 'undefined') perm = Notification.permission;
      if (P && typeof P.isActive === 'function') ativo = !!P.isActive();
    } catch (_) {}
    if (perm !== 'granted' && perm !== 'denied' && perm !== 'default') perm = (perm === 'unsupported' || perm === null) ? 'unsupported' : null;
    return { push_permissao: perm, push_ativo: ativo };
  }

  function sessaoProfissional() {
    try {
      var s = global.DB && global.DB.getSession && global.DB.getSession();
      return s && s.role === 'profissional' ? s : null;
    } catch (_) { return null; }
  }

  function chaveEstado(s, d, n) {
    return [s.userId, d.tipo_acesso, n.push_permissao, n.push_ativo].join('|');
  }

  async function registrar() {
    if (emAndamento) return { registrado: false, motivo: 'em_andamento' };
    var client = global.QFCloud && global.QFCloud.client;
    var sessao = sessaoProfissional();
    if (!client || !sessao) return { registrado: false, motivo: 'sem_sessao_profissional' };
    var d = detectarTipoAcesso(), n = estadoNotificacoes();
    var estado = chaveEstado(sessao, d, n);
    try {
      var salvo = JSON.parse(localStorage.getItem(CHAVE) || 'null');
      if (salvo && salvo.estado === estado && Date.now() - salvo.em < INTERVALO_MS) return { registrado: false, motivo: 'recente' };
    } catch (_) {}
    emAndamento = true;
    try {
      var r = await client.rpc('qf_registrar_acesso_profissional', {
        p_tipo: d.tipo_acesso, p_confianca: d.confianca, p_evidencia: d.evidencia,
        p_app_versao: d.app_versao, p_push_permissao: n.push_permissao, p_push_ativo: n.push_ativo
      });
      if (r && r.error) { console.warn('QuemFaz acesso não registrado', r.error.message || r.error); return { registrado: false, motivo: 'erro' }; }
      try { localStorage.setItem(CHAVE, JSON.stringify({ estado: estado, em: Date.now() })); } catch (_) {}
      return (r && r.data) || { registrado: false };
    } catch (e) {
      console.warn('QuemFaz acesso não registrado', e);
      return { registrado: false, motivo: 'erro' };
    } finally { emAndamento = false; }
  }

  // Nunca atrapalha o app: tudo roda depois do carregamento e com falhas silenciosas.
  function agendar(atraso) { setTimeout(function () { registrar().catch(function () {}); }, atraso || 4000); }

  global.QFAcessoProfissional = { detectarTipoAcesso: detectarTipoAcesso, estadoNotificacoes: estadoNotificacoes, registrar: registrar };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'complete') agendar(4000);
    else global.addEventListener('load', function () { agendar(4000); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') agendar(1500); });
    try {
      var c = global.QFCloud && global.QFCloud.client;
      if (c && c.auth && c.auth.onAuthStateChange) {
        c.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN') agendar(6000); });
      }
    } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : globalThis);


/* Apresentação visual do cadastro profissional — isolada do formulário e do Pix. */
(function(){
 'use strict';
 if(typeof document==='undefined')return;
 var styleId='qf-prof-apresentacao-estilo';
 function aplicar(){
  if(document.getElementById('qf-prof-apresentacao'))return;
  var headings=Array.from(document.querySelectorAll('h1,h2,h3,[role=heading]'));
  var h=headings.find(function(el){return /cadastro de profissional/i.test((el.textContent||'').trim())});
  if(!h)return;
  var form=h.closest('section,article,[role=dialog],.card,.modal,.panel')||h.parentElement;
  if(!form||form.id==='qf-prof-apresentacao'||form.querySelectorAll('input').length<2){
   var el=h.parentElement;
   for(var i=0;i<5&&el;i++,el=el.parentElement){if(el.querySelectorAll('input').length>=3){form=el;break}}
  }
  if(!form||form.querySelectorAll('input').length<3||!form.parentElement)return;
  if(form.closest('#qf-prof-apresentacao'))return;
  var wrap=document.createElement('div');wrap.id='qf-prof-apresentacao';
  var info=document.createElement('aside');info.className='qf-prof-apresentacao-info';
  info.innerHTML='<span class="qf-prof-chip">CADASTRO DE PROFISSIONAL</span><h2>Sua próxima oportunidade pode estar <em>aqui!</em></h2><p>Cadastre sua empresa ou profissão e encontre clientes procurando serviços na sua região.</p><div class="qf-prof-numeros"><div><strong>386</strong><span>profissionais cadastrados</span></div><div><strong>76</strong><span>cidades atendidas</span></div></div><ul><li>📍 Escolha onde deseja atender</li><li>🔔 Receba oportunidades da sua região</li><li>💬 Negocie diretamente com o cliente</li><li>✅ Sem comissão sobre serviços fechados</li></ul><div class="qf-prof-passos"><strong>Como funciona?</strong><p>1. Faça seu cadastro<br>2. Configure suas profissões e cidades<br>3. Escolha oportunidades e desbloqueie contatos conforme seu plano</p></div></aside>';
  form.parentNode.insertBefore(wrap,form);wrap.appendChild(info);wrap.appendChild(form);
  form.classList.add('qf-prof-apresentacao-form');
  if(!document.getElementById(styleId)){
   var css=document.createElement('style');css.id=styleId;css.textContent=
   '#qf-prof-apresentacao{width:min(1200px,calc(100% - 24px));max-width:1200px;margin:20px auto 45px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:22px;align-items:start;box-sizing:border-box;font-family:inherit}'+
   '#qf-prof-apresentacao *{box-sizing:border-box}#qf-prof-apresentacao .qf-prof-apresentacao-form{width:100%!important;max-width:none!important;margin:0!important;min-width:0}'+
   '.qf-prof-apresentacao-info{border-radius:25px;padding:32px;background:linear-gradient(145deg,#0755b8,#073a80 70%,#e8f4ff 70.1%);color:white;min-height:600px;box-shadow:0 12px 30px #0c438022}'+
   '.qf-prof-apresentacao-info h2{font-size:clamp(28px,3vw,43px);line-height:1.12;margin:20px 0;color:#fff;font-weight:850}.qf-prof-apresentacao-info h2 em{color:#ff9c22;font-style:normal}'+
   '.qf-prof-apresentacao-info>p{font-size:17px;line-height:1.5;color:#fff}.qf-prof-chip{display:inline-block;background:#ff850e;color:white;border-radius:99px;padding:10px 16px;font-weight:800;font-size:13px}'+
   '.qf-prof-numeros{display:flex;gap:20px;background:white;color:#093c86;border-radius:18px;padding:18px;margin:25px 0;box-shadow:0 5px 15px #0002}.qf-prof-numeros div{flex:1;display:flex;flex-direction:column}.qf-prof-numeros strong{font-size:36px;line-height:1}.qf-prof-numeros span{font-size:13px;font-weight:700}'+
   '.qf-prof-apresentacao-info ul{list-style:none;padding:0;margin:22px 0;color:#0d305f;font-weight:750;line-height:1.5}.qf-prof-apresentacao-info li{padding:9px 0;border-bottom:1px solid #cbdff4}'+
   '.qf-prof-passos{background:#fff;border-radius:16px;padding:18px;color:#123f80}.qf-prof-passos strong{font-size:21px}.qf-prof-passos p{line-height:1.9;margin:8px 0 0;color:#26466e;font-size:14px}'+
   '@media(max-width:800px){#qf-prof-apresentacao{display:flex;flex-direction:column;width:calc(100% - 20px);gap:14px;margin:10px auto 30px}.qf-prof-apresentacao-info{width:100%;min-height:0;padding:20px;border-radius:20px;background:linear-gradient(145deg,#0755b8,#073a80 65%,#e8f4ff 65.1%)}.qf-prof-apresentacao-info h2{font-size:30px;margin:14px 0}.qf-prof-apresentacao-info>p{font-size:14px}.qf-prof-numeros{margin:16px 0;padding:12px}.qf-prof-numeros strong{font-size:27px}.qf-prof-apresentacao-info ul{font-size:13px}.qf-prof-passos{padding:12px}.qf-prof-passos strong{font-size:18px}}';
   document.head.appendChild(css);
  }
 }
 function iniciar(){aplicar();var count=0;var obs=new MutationObserver(function(){if(++count>300){obs.disconnect();return}aplicar()});obs.observe(document.body,{childList:true,subtree:true});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();
