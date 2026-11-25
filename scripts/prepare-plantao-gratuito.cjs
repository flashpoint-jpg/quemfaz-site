'use strict';

module.exports = function preparePlantaoGratuito(html) {
  function replace(anchor, replacement) {
    if (!html.includes(anchor)) throw new Error('Cadastro Plantão 24h: trecho não encontrado');
    html = html.replace(anchor, replacement);
  }

  const tools = `          '<section class="card qf-cad-ferramentas" data-cadastro-exploracao`;
  replace(tools, `          '<section class="qf-options-card qf-options-card--plantao" data-cad-plantao-card aria-labelledby="qf-cad-plantao-titulo">' +
            '<span class="qf-options-badge">PLANTÃO</span>' +
            '<div class="qf-options-top"><span class="qf-options-icon" aria-hidden="true">' + icon('clock') + '</span>' +
              '<div class="qf-options-headings"><h3 class="qf-options-name" id="qf-cad-plantao-titulo">Plantão 24 horas</h3>' +
              '<div class="qf-options-price">R$ 0,00 <small>Inscrição gratuita</small></div></div></div>' +
            '<ul class="qf-options-list"><li>Receba chamados urgentes</li></ul>' +
            '<p class="qf-options-note">Para eletricistas, encanadores, chaveiros e guinchos. Sem Pix para cadastrar. Ative seu plantão quando disponível.</p>' +
            '<p class="qf-options-note" data-cad-plantao-restricao hidden>Para criar sua conta pelo Plantão, selecione apenas profissões da lista acima na etapa 2.</p>' +
            '<button class="qf-options-button" type="submit" data-cad-plantao>Criar conta grátis</button>' +
          '</section>' +
` + tools);

  replace("      qf_role: role,\n      qf_nome: data.nome,", `      ...(cadastroExploracao && data.plantaoGratis ? {qf_plantao_gratis: true} : {}),
      qf_role: role,
      qf_nome: data.nome,`);

  replace('      function botaoPlano() {', `      function profissaoPlantao() {
        const permitidas = global.QFPlantao24h?.categorias || [];
        return selected.length > 0 && selected.every(id => permitidas.includes(id));
      }
      function botaoPlano() {
        const plantao = form.querySelector('[data-cad-plantao]');
        if (plantao) {
          plantao.disabled = !profissaoPlantao();
          form.querySelector('[data-cad-plantao-restricao]').hidden = !plantao.disabled;
          form.querySelector('[data-cad-plantao-card]').hidden = !!global.QFConvite24h?.token();
        }`);

  replace('          goStep(Math.min(5, stepAtual + 1));', `          goStep(Math.min(5, stepAtual + 1));
          if (stepAtual === 5) botaoPlano();`);

  replace(`        const cadastroExploracao = !conviteToken && !!e.submitter?.hasAttribute('data-cad-explorar');
        const botoesCadastro = form.querySelectorAll('[data-cad-criar], [data-cad-explorar]');`, `        const plantaoGratis = !conviteToken && !!e.submitter?.hasAttribute('data-cad-plantao');
        if (plantaoGratis && !profissaoPlantao()) {
          PU.toast('Escolha apenas as profissões atendidas pelo Plantão 24h.', 'danger');
          goStep(2);
          return;
        }
        const cadastroExploracao = !conviteToken && (plantaoGratis || !!e.submitter?.hasAttribute('data-cad-explorar'));
        const botoesCadastro = form.querySelectorAll('[data-cad-criar], [data-cad-explorar], [data-cad-plantao]');`);

  replace('{...dados, cadastroExploracaoToken: preparo.data.token}', '{...dados, plantaoGratis, cadastroExploracaoToken: preparo.data.token}');
  replace("PU.toast('Confirme seu e-mail e entre para conhecer o painel.', 'success');",
    "PU.toast(plantaoGratis ? 'Confirme seu e-mail. No painel, abra o Plantão 24h para ficar disponível.' : 'Confirme seu e-mail e entre para conhecer o painel.', 'success');");
  replace("PU.toast('Conta gratuita criada. Bem-vindo ao Quem Faz!', 'success');",
    "PU.toast(plantaoGratis ? 'Conta criada. Abra o Plantão 24h no painel e marque Estou de plantão.' : 'Conta gratuita criada. Bem-vindo ao Quem Faz!', 'success');");
  replace('          botoesCadastro.forEach(function (b) { b.disabled = false; });',
    '          botoesCadastro.forEach(function (b) { b.disabled = false; });\n          botaoPlano();');

  return html;
};
