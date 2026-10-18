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
