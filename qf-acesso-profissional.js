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


/* Cadastro profissional — apresentação aprovada, sem alterar campos ou pagamentos. */
(function(){
 'use strict';
 if(typeof document==='undefined')return;
 function aplicar(){
  if(document.getElementById('qf-prof-apresentacao'))return;
  var h=Array.from(document.querySelectorAll('h1,h2,h3,[role=heading]')).find(function(e){return /cadastro de profissional/i.test((e.textContent||'').trim())});
  if(!h)return;
  var form=h.closest('section,article,[role=dialog],.card,.modal,.panel')||h.parentElement;
  if(!form||form.querySelectorAll('input').length<3){
   for(var el=h.parentElement,i=0;el&&i<6;el=el.parentElement,i++){if(el.querySelectorAll('input').length>=3){form=el;break}}
  }
  if(!form||form.querySelectorAll('input').length<3||!form.parentNode)return;
  var wrap=document.createElement('div');wrap.id='qf-prof-apresentacao';
  var header=document.createElement('header');header.className='qf-prof-header';
  header.innerHTML='<a href="/" class="qf-prof-brand" aria-label="Quem Faz Serviços"><b>Q<span>F</span></b><strong>QuemFaz<small>Serviços</small></strong></a><nav aria-label="Navegação"><a href="/">Início</a><a href="/#como-funciona">Como funciona</a><a href="/#profissionais">Profissionais</a><a href="/#servicos">Serviços</a></nav><a class="qf-prof-home" href="/">Sou cliente</a>';
  var info=document.createElement('aside');info.className='qf-prof-apresentacao-info';
  info.innerHTML='<div class="qf-prof-hero"><span class="qf-prof-chip">Cadastro de Profissional</span><h2>Sua próxima oportunidade pode estar <em>aqui!</em></h2><p>Cadastre sua profissão e acompanhe pedidos de clientes da sua região.</p></div><div class="qf-prof-numeros"><div><strong>386</strong><span>profissionais cadastrados</span></div><div><strong>76</strong><span>cidades atendidas</span></div></div><div class="qf-prof-beneficios"><div>🎯<span>Receba oportunidades</span></div><div>💬<span>Negocie diretamente</span></div><div>📅<span>Defina seu raio e horários</span></div><div>🛡️<span>Sem comissão por serviço fechado</span></div></div><div class="qf-prof-passos"><strong>Como funciona?</strong><ol><li>Faça seu cadastro</li><li>Configure profissão, região e horários</li><li>Escolha oportunidades disponíveis</li></ol></div>';
  var grid=document.createElement('div');grid.className='qf-prof-grid';
  form.parentNode.insertBefore(wrap,form);wrap.appendChild(header);wrap.appendChild(grid);grid.appendChild(info);grid.appendChild(form);
  form.classList.add('qf-prof-apresentacao-form');
  var css=document.createElement('style');css.id='qf-prof-apresentacao-estilo';css.textContent=
  '#qf-prof-apresentacao{width:100%;max-width:1440px;margin:0 auto 40px;font-family:Inter,system-ui,Arial,sans-serif;color:#102b65;box-sizing:border-box}#qf-prof-apresentacao *{box-sizing:border-box}'+
  '.qf-prof-header{min-height:75px;background:#fff;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:12px clamp(18px,4vw,65px);border-bottom:1px solid #dce5f2}.qf-prof-brand{display:flex;align-items:center;gap:8px;text-decoration:none!important;color:#0b3595!important}.qf-prof-brand>b{font-size:37px;letter-spacing:-5px}.qf-prof-brand>b span{color:#ff7900}.qf-prof-brand strong{font-size:22px;line-height:1}.qf-prof-brand small{display:block;color:#ff7900;font-size:14px}.qf-prof-header nav{display:flex;gap:22px}.qf-prof-header nav a{color:#123378!important;text-decoration:none;font-weight:750;font-size:14px}.qf-prof-home{border:2px solid #1255bf;border-radius:24px;padding:10px 18px;color:#0b3595!important;text-decoration:none!important;font-weight:750;white-space:nowrap}'+
  '.qf-prof-grid{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);gap:24px;padding:24px;align-items:stretch;background:linear-gradient(120deg,#0754bf,#0868d5 65%,#e6f1ff)}'+
  '#qf-prof-apresentacao .qf-prof-apresentacao-form{width:100%!important;max-width:none!important;margin:0!important;min-width:0;background:#fff!important;border-radius:24px!important;padding:clamp(18px,3vw,34px)!important;box-shadow:0 12px 28px #003d8520!important;align-self:stretch}'+
  '.qf-prof-apresentacao-info{min-width:0;display:flex;flex-direction:column;gap:20px;padding:18px 8px;color:#fff!important}.qf-prof-hero h2{font-size:clamp(29px,3.3vw,49px);line-height:1.12;letter-spacing:-.025em;color:#fff!important;margin:18px 0;font-weight:850}.qf-prof-hero h2 em{color:#ffab24;font-style:normal}.qf-prof-hero p{color:#fff!important;font-size:clamp(16px,1.5vw,20px);line-height:1.5;max-width:560px}.qf-prof-chip{display:inline-block;background:#ff8a00;color:#fff;border-radius:28px;padding:10px 18px;font-weight:800;font-size:16px}'+
  '.qf-prof-numeros{display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#fff;border-radius:18px;padding:18px;color:#0b358a;box-shadow:0 8px 18px #002e6a25}.qf-prof-numeros>div{display:flex;align-items:center;gap:12px}.qf-prof-numeros strong{font-size:clamp(30px,3vw,43px);color:#ff8000;line-height:1}.qf-prof-numeros span{font-size:clamp(13px,1.2vw,16px);font-weight:800;line-height:1.25;color:#0b358a}'+
  '.qf-prof-beneficios{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qf-prof-beneficios>div{display:flex;align-items:center;gap:10px;background:#ffffff17;border:1px solid #ffffff55;border-radius:14px;padding:13px;font-weight:750;color:#fff;line-height:1.3}.qf-prof-beneficios span{font-size:14px}'+
  '.qf-prof-passos{margin-top:auto;background:#fff;border-radius:20px;padding:20px;color:#0c3687;box-shadow:0 8px 20px #00357a30}.qf-prof-passos strong{font-size:23px}.qf-prof-passos ol{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;list-style:none;counter-reset:passo;padding:0;margin:18px 0 0}.qf-prof-passos li{counter-increment:passo;display:flex;align-items:center;gap:9px;font-weight:750;font-size:13px;line-height:1.3;color:#0b358a}.qf-prof-passos li:before{content:counter(passo);display:grid;place-items:center;flex:none;width:35px;height:35px;background:#ff8500;color:white;border-radius:50%;font-size:18px}'+
  '#qf-prof-apresentacao .qf-prof-apresentacao-form input,#qf-prof-apresentacao .qf-prof-apresentacao-form select{min-height:46px}'+
  '@media(max-width:850px){.qf-prof-header{padding:12px 16px;min-height:64px}.qf-prof-header nav{display:none}.qf-prof-brand strong{font-size:18px}.qf-prof-brand>b{font-size:30px}.qf-prof-home{font-size:12px;padding:8px 12px}.qf-prof-grid{display:flex;flex-direction:column;gap:12px;padding:12px}.qf-prof-apresentacao-info{padding:15px 8px;gap:14px}.qf-prof-hero h2{font-size:30px}.qf-prof-chip{font-size:13px}.qf-prof-numeros{padding:13px}.qf-prof-numeros strong{font-size:29px}.qf-prof-numeros span{font-size:12px}.qf-prof-beneficios>div{padding:10px;font-size:12px}.qf-prof-beneficios span{font-size:12px}.qf-prof-passos{padding:15px}.qf-prof-passos strong{font-size:20px}.qf-prof-passos ol{grid-template-columns:1fr;gap:9px}.qf-prof-passos li{font-size:13px}#qf-prof-apresentacao .qf-prof-apresentacao-form{padding:18px!important}}';
  /* Ajustes de identidade visual e legibilidade — desktop e celular. */
  css.textContent +=
  '#qf-prof-apresentacao{background:#071d3b!important}'+
  '#qf-prof-apresentacao .qf-prof-header{position:sticky!important;top:0!important;z-index:100!important;background:#071d3b!important;border-bottom:2px solid #ff8a00!important;box-shadow:0 3px 12px #0003!important}'+
  '#qf-prof-apresentacao .qf-prof-header nav a,#qf-prof-apresentacao .qf-prof-brand,#qf-prof-apresentacao .qf-prof-home{color:#fff!important}'+
  '#qf-prof-apresentacao .qf-prof-home{border-color:#7486a0!important}'+
  '#qf-prof-apresentacao .qf-prof-grid{background:#071d3b!important;align-items:start!important}'+
  '#qf-prof-apresentacao .qf-prof-apresentacao-info{background:transparent!important;gap:18px!important;padding:20px 12px!important}'+
  '#qf-prof-apresentacao .qf-prof-numeros{background:#fff!important}'+
  '#qf-prof-apresentacao .qf-prof-numeros strong{color:#f58212!important}'+
  '#qf-prof-apresentacao .qf-prof-beneficios>div{background:#12375e!important;border:1px solid #3d648c!important}'+
  '#qf-prof-apresentacao .qf-prof-passos{margin-top:10px!important}'+
  '#qf-prof-apresentacao .qf-prof-apresentacao-form{align-self:start!important;overflow:visible!important}'+
  '#qf-prof-apresentacao .qf-prof-apresentacao-form button[type=submit]{position:relative!important;inset:auto!important;transform:none!important;display:block!important;width:100%!important;min-height:52px!important;margin:20px 0 4px!important;z-index:1!important;background:#ff8500!important;color:#fff!important;border-radius:12px!important}'+
  '@media(max-width:850px){#qf-prof-apresentacao .qf-prof-header{top:0!important;min-height:62px!important}#qf-prof-apresentacao .qf-prof-grid{padding:10px!important;gap:14px!important}#qf-prof-apresentacao .qf-prof-apresentacao-info{padding:12px 8px!important}#qf-prof-apresentacao .qf-prof-hero h2{font-size:29px!important}#qf-prof-apresentacao .qf-prof-apresentacao-form{padding:18px!important;padding-bottom:32px!important;min-height:0!important}#qf-prof-apresentacao .qf-prof-apresentacao-form button{max-width:100%!important}#qf-prof-apresentacao .qf-prof-apresentacao-form button[type=submit]{position:static!important;margin:20px 0 8px!important}#qf-prof-apresentacao .qf-prof-apresentacao-form input{position:relative!important;z-index:2!important}#qf-prof-apresentacao .qf-prof-numeros{gap:8px!important}#qf-prof-apresentacao .qf-prof-numeros>div{flex-wrap:wrap!important}#qf-prof-apresentacao .qf-prof-passos ol{grid-template-columns:1fr!important}}';
  /* V3: conteúdo comercial complementar, sem alterar a lógica de cadastro. */
  var faq=document.createElement('section');faq.className='qf-prof-info-extra';
  faq.innerHTML='<h3>Por que se cadastrar?</h3><p>Você escolhe as oportunidades que fazem sentido para sua empresa, de acordo com a profissão e a região onde atende.</p><div class="qf-prof-extra-grid"><div><b>📍 Atendimento local</b><span>Configure seu raio de atuação e acompanhe pedidos da região.</span></div><div><b>🛠️ Diversas profissões</b><span>Informe suas especialidades para encontrar pedidos compatíveis.</span></div><div><b>💬 Você decide</b><span>Analise as oportunidades e negocie diretamente com o cliente.</span></div><div><b>📲 Acompanhe pelo celular</b><span>Consulte os pedidos disponíveis e gerencie seus atendimentos.</span></div></div><p class="qf-prof-extra-nota">As oportunidades dependem dos pedidos publicados pelos clientes em cada região. Consulte as condições atuais de acesso durante o cadastro.</p>';
  info.appendChild(faq);
  css.textContent +=
  '#qf-prof-apresentacao .qf-prof-header{position:fixed!important;left:0!important;right:0!important;top:0!important;width:100%!important;z-index:10000!important;transform:none!important}'+
  '#qf-prof-apresentacao{padding-top:76px!important}'+
  '#qf-prof-apresentacao .qf-prof-grid{align-items:stretch!important;min-height:calc(100vh - 76px)!important}'+
  '#qf-prof-apresentacao .qf-prof-apresentacao-info{justify-content:flex-start!important}'+
  '.qf-prof-info-extra{background:#12375e;border:1px solid #3d648c;border-radius:20px;padding:22px;color:#fff;margin-top:4px}'+
  '.qf-prof-info-extra h3{color:#fff;font-size:24px;margin:0 0 10px;font-weight:850}.qf-prof-info-extra>p{color:#e9f2ff;font-size:15px;line-height:1.5;margin:0 0 16px}'+
  '.qf-prof-extra-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qf-prof-extra-grid>div{background:#071d3b;border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:7px}'+
  '.qf-prof-extra-grid b{color:#fff;font-size:15px}.qf-prof-extra-grid span{color:#e5efff;font-size:13px;line-height:1.45}.qf-prof-info-extra .qf-prof-extra-nota{margin:16px 0 0;font-size:12px;color:#d9e7f8}'+
  '@media(max-width:850px){#qf-prof-apresentacao{padding-top:64px!important}#qf-prof-apresentacao .qf-prof-grid{min-height:0!important;align-items:start!important}#qf-prof-apresentacao .qf-prof-info-extra{padding:14px;margin-top:0}#qf-prof-apresentacao .qf-prof-info-extra h3{font-size:19px}#qf-prof-apresentacao .qf-prof-info-extra>p{font-size:13px}#qf-prof-apresentacao .qf-prof-extra-grid{grid-template-columns:1fr 1fr;gap:8px}#qf-prof-apresentacao .qf-prof-extra-grid>div{padding:10px}#qf-prof-apresentacao .qf-prof-extra-grid b{font-size:12px}#qf-prof-apresentacao .qf-prof-extra-grid span{font-size:11px}}';
  /* Na escolha de planos, usar a largura disponível em vez de uma coluna longa. */
  css.textContent +=
  '#qf-prof-apresentacao:has(#cadastro-prof-form [data-step="5"]:not([hidden])) .qf-prof-apresentacao-info{display:none!important}'+
  '#qf-prof-apresentacao:has(#cadastro-prof-form [data-step="5"]:not([hidden])) .qf-prof-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;align-items:start!important;min-height:0!important;max-width:1100px;margin:0 auto;padding:24px!important}'+
  '#qf-prof-apresentacao:has(#cadastro-prof-form [data-step="5"]:not([hidden])) .qf-prof-apresentacao-form{padding:24px!important}'+
  '#qf-prof-apresentacao #cadastro-prof-form{min-height:0!important}'+
  '#qf-prof-apresentacao #cadastro-prof-form:has([data-step="5"]:not([hidden])) [data-qf-planos-chamada]{display:none!important}'+
  '@media(min-width:851px){#qf-prof-apresentacao #cadastro-prof-form [data-step="5"] .qf-options-final{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}#qf-prof-apresentacao #cadastro-prof-form [data-step="5"] .qf-options-card{grid-template-rows:auto auto auto 1fr auto;align-content:start}}'+
  '@media(max-width:850px){#qf-prof-apresentacao:has(#cadastro-prof-form [data-step="5"]:not([hidden])) .qf-prof-grid{padding:12px!important}#qf-prof-apresentacao:has(#cadastro-prof-form [data-step="5"]:not([hidden])) .qf-prof-apresentacao-form{padding:18px!important;border-radius:18px!important}}';
  document.head.appendChild(css);
 }
 function iniciar(){aplicar();var obs=new MutationObserver(function(){aplicar()});obs.observe(document.body,{childList:true,subtree:true});}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',iniciar);else iniciar();
})();
