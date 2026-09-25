/* QuemFaz — links da Google Play e contato.
   TROQUE AQUI (e só aqui) quando tiver os links do Play Console:
   - LINK_DO_GRUPO: link do Grupo do Google dos testadores (ex.: https://groups.google.com/g/quemfaz-testadores)
   - LINK_DO_TESTE: link "Participar no Android" do teste fechado (ex.: https://play.google.com/apps/testing/br.app.quemfaz)
   - EMAIL_CONTATO: e-mail de contato mostrado na política de privacidade e na exclusão de conta (vazio = não mostra) */
window.QF_PLAY = {
  LINK_DO_GRUPO: 'LINK_DO_GRUPO',
  LINK_DO_TESTE: 'LINK_DO_TESTE',
  EMAIL_CONTATO: '',
  LINK_DA_LOJA: 'https://play.google.com/store/apps/details?id=br.app.quemfaz'
};

(function () {
  function pronto(v) { return /^https:\/\//i.test(v || ''); }
  function aplicar() {
    var cfg = window.QF_PLAY;
    document.querySelectorAll('[data-play-link]').forEach(function (a) {
      var url = cfg[a.getAttribute('data-play-link')];
      if (pronto(url)) { a.href = url; a.removeAttribute('aria-disabled'); }
      else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.title = 'Link disponível em breve'; }
    });
    document.querySelectorAll('[data-contato-email]').forEach(function (el) {
      if (cfg.EMAIL_CONTATO) {
        el.hidden = false;
        var a = el.querySelector('a');
        if (a) { a.href = 'mailto:' + cfg.EMAIL_CONTATO; a.textContent = cfg.EMAIL_CONTATO; }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', aplicar);
  else aplicar();
})();
