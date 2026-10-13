/* Regra de saldo e pacotes — apenas informação visual, sem alterar valores. */
(function () {
  'use strict';
  var CARD_ID = 'qf-wallet-balance-rules';
  var cssText = [
    '#'+CARD_ID+'{border:1px solid #dbe4ef;background:#fff;border-radius:16px;',
    'padding:16px;margin:12px 0 0;box-shadow:0 4px 12px rgba(11,29,58,.04)}',
    '#'+CARD_ID+' .qf-balance-rule{display:block;}',
    '#'+CARD_ID+' .qf-balance-rule + .qf-balance-rule{border-top:1px solid #e7ecf3;margin-top:12px;padding-top:12px;}',
    '#'+CARD_ID+' strong{display:block;color:#0b1d3a;font-size:15px;line-height:1.35;margin-bottom:4px;}',
    '#'+CARD_ID+' p{font-size:13px;line-height:1.5;color:#45516a;margin:0;}'
  ].join('');
  function place() {
    var route = location.hash || '';
    if (!/^#\/?profissional\/carteira(?:$|[?\/])/.test(route)) return;
    var shell = document.getElementById('app-content');
    if (!shell || shell.querySelector('#' + CARD_ID)) return;
    var candidates = shell.querySelectorAll('.view .card');
    var walletCard = null;
    for (var i = 0; i < candidates.length; i++) {
      if ((candidates[i].textContent || '').indexOf('Saldo disponível') >= 0) {
        walletCard = candidates[i];
        break;
      }
    }
    if (!walletCard) return;
    var panel = document.createElement('section');
    panel.id = CARD_ID;
    panel.setAttribute('aria-label', 'O que acontece com o saldo da carteira');
    panel.innerHTML = 
      '<div class="qf-balance-rule"><strong>Saldo da carteira: não expira</strong>' +
      '<p>O dinheiro colocado por Pix, cartão ou boleto continua disponível mesmo depois de 30 dias sem uso. Você pode utilizá-lo para desbloquear chamados quando quiser.</p></div>' +
      '<div class="qf-balance-rule"><strong>Bônus de recarga: validade de 30 dias</strong>' +
      '<p>Recargas a partir de R$ 50 ganham bônus (+10%; +15% a partir de R$ 100; +20% a partir de R$ 200). O bônus é usado primeiro nos desbloqueios e o que sobrar vence em 30 dias.</p></div>' +
      '<div class="qf-balance-rule"><strong>Pacotes: validade de 30 dias</strong>' +
      '<p>Os desbloqueios não utilizados vencem ao final do prazo. Se você renovar antes do vencimento, os desbloqueios restantes são transferidos para o novo pacote.</p></div>';
    walletCard.insertAdjacentElement('afterend', panel);
  }
  function init() {
    if (!document.getElementById('qf-wallet-rules-style')) {
      var style = document.createElement('style');
      style.id = 'qf-wallet-rules-style';
      style.textContent = cssText;
      document.head.appendChild(style);
    }
    place();
    var target = document.getElementById('app-shell') || document.body;
    if (!target) return;
    new MutationObserver(place).observe(target, { childList: true, subtree: true });
    window.addEventListener('hashchange', place);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
