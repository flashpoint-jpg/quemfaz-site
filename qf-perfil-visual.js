/* Apenas organiza a apresentação de consentimento quando uma versão antiga a injeta no Perfil.
   Não ativa divulgação, não altera autorização nem grava informações. */
(function (g) {
  'use strict';
  function simplificar() {
    if (!g.location || !/profissional\/perfil/.test(g.location.hash || '')) return;
    const headings = Array.from(document.querySelectorAll('h2,h3,h4'));
    const title = headings.find(function (el) {
      return (el.textContent || '').trim().toLowerCase() === 'visibilidade pública do perfil';
    });
    if (!title) return;
    const card = title.closest('.card') || title.closest('section');
    if (!card || card.dataset.qfPerfilVisibilidadeResumida === '1') return;
    card.dataset.qfPerfilVisibilidadeResumida = '1';
    card.classList.add('qf-perfil-visibilidade-resumida');

    const label = Array.from(card.querySelectorAll('label')).find(function (n) {
      return n.querySelector('input[type="checkbox"]') && /autor(i|izo)|exibi|publica/i.test(n.textContent || '');
    });
    if (label) {
      // Reutiliza o próprio checkbox; mantém os eventos e o estado do consentimento.
      const input = label.querySelector('input[type="checkbox"]');
      while (label.firstChild) label.removeChild(label.firstChild);
      label.appendChild(input);
      const span = document.createElement('span');
      span.textContent = 'Autorizo a exibição pública do meu perfil profissional no Quem Faz e no Google.';
      label.appendChild(span);
      label.style.cssText += ';display:flex;gap:12px;align-items:flex-start;line-height:1.45';
      input.style.cssText += ';width:22px;height:22px;min-width:22px;accent-color:#1769d5;margin-top:3px';
    }

    const paragraphs = Array.from(card.querySelectorAll('p,div')).filter(function (el) {
      return el.children.length === 0;
    });
    paragraphs.forEach(function (p) {
      const text = (p.textContent || '').trim();
      if (/poderão aparecer|poder(a|ã)o aparecer/i.test(text) && /cpf|telefone|endere/i.test(text)) {
        p.textContent = 'Serão exibidos: nome profissional, serviços oferecidos e cidades atendidas.';
        p.classList.add('text--sm', 'text--secondary');
      } else if (/divulga[cç][aã]o p[uú]blica indispon[ií]vel|migra[cç][aã]o ser validada/i.test(text)) {
        p.textContent = 'A divulgação pública ainda não está disponível.';
        p.classList.add('qf-perfil-privacy-notice');
      }
    });
    const save = Array.from(card.querySelectorAll('button')).find(function (b) {
      return /salvar autoriza[cç][aã]o/i.test(b.textContent || '');
    });
    if (save) {
      save.classList.add('btn', 'btn--primary');
      save.style.cssText += ';width:100%;min-height:50px;white-space:normal;border-radius:14px;text-align:center';
      // Estado disabled é preservado se o servidor ainda não permitir publicar o perfil.
    }
  }
  function install() {
    simplificar();
    const target = document.querySelector('#app-shell') || document.body;
    if (!target || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(simplificar);
    observer.observe(target, {childList:true,subtree:true});
    g.addEventListener('hashchange', simplificar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})(window);
