/* Recupera uma cobrança assistida no aparelho do titular. Não confirma pagamento. */
(function (g) {
  'use strict';
  const marker = '#/pix-cadastro/';
  if (!g.location.hash.startsWith(marker)) return;
  try {
    const data = JSON.parse(decodeURIComponent(g.location.hash.slice(marker.length)));
    if (!/^[a-f0-9-]{36}$/i.test(data.id) || !/^[a-f0-9]{48}$/i.test(data.segredo) ||
        !['avulso','basico_v2','pro_v2','completo_v2'].includes(data.plano) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 200) return;
    const previous = JSON.parse(g.localStorage.getItem('qf_pre_cadastro') || 'null');
    // Não substituir silenciosamente outra cobrança que esteja neste aparelho.
    if (previous?.pag?.id && previous.pag.id !== data.id &&
        !g.confirm('Existe outro cadastro em andamento neste aparelho. Abrir a cobrança recebida da equipe Quem Faz?')) return;
    g.localStorage.setItem('qf_pre_cadastro', JSON.stringify({em:Date.now(), manual:true,
      plano:data.plano, dados:{email:data.email.trim().toLowerCase()},
      pag:{id:data.id,segredo:data.segredo,metodo:'pix',pix:''}}));
    g.history.replaceState(g.history.state, '', g.location.pathname + g.location.search + '#/auth/profissional/cadastro');
  } catch (_) { /* Link inválido não altera o cadastro. */ }
})(window);
