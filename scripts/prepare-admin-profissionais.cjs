// Integra a busca e a gestão de vigência ao renderizador administrativo existente.
module.exports = function prepareAdminProfissionais(source) {
  function replace(before, after) {
    if (source.split(before).length !== 2) throw Error('Integração de profissionais não encontrada: ' + before);
    source = source.replace(before, () => after);
  }

  const search = `        '<section class="card card--tight stack--sm" aria-labelledby="qf-prof-busca-titulo"><h2 class="h3" id="qf-prof-busca-titulo">Localizar profissional</h2>' +
        '<label class="field"><span class="field__label">Nome, telefone ou e-mail</span><input class="input" type="search" id="qf-prof-busca" placeholder="Ex.: Patrick ou número do WhatsApp" value="' + PU.escapeHtml(profBusca) + '"></label>' +
        '<p class="text--sm text--secondary" role="status" data-prof-resultados></p></section>' +
        '<details class="card card--tight" data-prof-interessados><summary>Novos cadastros e pagamentos</summary></details>' +
        '<details class="card card--tight" style="margin-bottom:10px"><summary>Testes de notificações</summary>' +`;
  const stats = `        '<div class="card card--tight" style="margin-bottom:10px;"><div class="text--sm text--secondary">' + ordered.length`;
  replace(stats, search + '\n' + stats);

  const listStart = `        '<input class="input" type="search" id="qf-prof-busca" placeholder="Buscar por nome, telefone ou e-mail" value="' + PU.escapeHtml(profBusca) + '" style="margin-bottom:10px;">' +`;
  replace(listStart, `        '</details>' +`);
  replace("ordered.filter(function (g) { return profCidadeFiltro === 'todas' || g.key === profCidadeFiltro; }).map(function (g) {",
    'ordered.map(function (g) {');
  replace(`return '<section class="qf-prof-city">' +`, `return '<section class="qf-prof-city" data-prof-grupo="' + PU.escapeHtml(g.key) + '">' +`);
  replace(`return '<div data-prof-search="' + PU.escapeHtml(catNormAdmin(p.nome`, `return '<div data-prof-nome="' + PU.escapeHtml(catNormAdmin(p.nome)) + '" data-prof-search="' + PU.escapeHtml(catNormAdmin(p.nome`);

  const filterStart = source.indexOf("    const busca = content.querySelector('#qf-prof-busca');");
  const filterEnd = source.indexOf('\n  }', filterStart);
  if (filterStart < 0 || filterEnd < 0) throw Error('Filtro de profissionais não encontrado');
  source = source.slice(0, filterStart) + String.raw`    const busca = content.querySelector('#qf-prof-busca');
    const resultados = content.querySelector('[data-prof-resultados]');
    const grupos = Array.from(content.querySelectorAll('[data-prof-grupo]'), function (sec) {
      return { sec: sec, cards: Array.from(sec.querySelectorAll('[data-prof-search]')) };
    });
    function proximo(palavra, nome) {
      if (nome.startsWith(palavra)) return true;
      if (palavra.length < 4 || Math.abs(palavra.length - nome.length) > 1) return false;
      const curta = palavra.length <= nome.length ? palavra : nome;
      const longa = palavra.length <= nome.length ? nome : palavra;
      let i = 0;
      while (i < curta.length && curta[i] === longa[i]) i++;
      return curta.slice(i + (curta.length === longa.length ? 1 : 0)) === longa.slice(i + 1);
    }
    function filtrar() {
      profBusca = busca.value;
      const q = catNormAdmin(profBusca).replace(/\s+/g, ' ');
      const qTel = /^[\d\s()+.\-]+$/.test(q) ? q.replace(/\D/g, '').replace(/^0+/, '').replace(/^55(?=\d{10,11}$)/, '') : '';
      const termos = /^[a-z ]+$/.test(q) ? q.split(' ') : [];
      let total = 0;
      grupos.forEach(function (g) {
        const naCidade = !!q || profCidadeFiltro === 'todas' || g.sec.dataset.profGrupo === profCidadeFiltro;
        let n = 0;
        g.cards.forEach(function (card) {
          const hay = card.dataset.profSearch;
          const nome = card.dataset.profNome.split(/\s+/);
          const achou = naCidade && (!q || hay.includes(q) || (qTel && hay.includes(qTel)) ||
            (termos.length && termos.every(function (termo) { return nome.some(function (parte) { return proximo(termo, parte); }); })));
          card.hidden = !achou;
          if (achou) n++;
        });
        g.sec.hidden = !n;
        total += n;
      });
      content.querySelector('.qf-prof-cities').style.display = q ? 'none' : '';
      resultados.textContent = total
        ? total + (total === 1 ? ' profissional encontrado' : ' profissionais encontrados') + (q ? ' · todas as cidades' : '')
        : 'Nenhum profissional encontrado. Tente parte do nome, telefone ou e-mail.';
    }
    busca.addEventListener('input', filtrar);
    filtrar();` + source.slice(filterEnd);

  const profileAnchor = `      '<section class="section card stack--sm" aria-label="Teste individual de chamado">' +`;
  const oldWallet = source.indexOf(`      '<div class="section"><div class="section-head"><h2 class="h3">Adicionar créditos</h2></div><div class="card stack--sm">' +`);
  const walletEnd = source.indexOf('      (txs.length ?', oldWallet);
  if (oldWallet < 0 || walletEnd < 0) throw Error('Carteira do profissional não encontrada');
  source = source.slice(0, oldWallet) + source.slice(walletEnd);
  replace(profileAnchor, `      adminProfCarteiraHtml(p) +\n      adminProfGestaoHtml(p) +\n` + profileAnchor);
  replace(`      '<span class="badge badge--navy">' + PU.formatCurrency(p.saldo || 0) + '</span>';`,
    `      '<span class="badge badge--navy" data-prof-saldo-atual>' + PU.formatCurrency(p.saldo || 0) + '</span>';`);
  replace(`        rowInfo('Saldo em carteira', PU.formatCurrency(p.saldo || 0)) +\n        rowInfo('Cadastro',`,
    `        rowInfoHtml('Saldo em carteira', '<span data-prof-saldo-atual>' + PU.formatCurrency(p.saldo || 0) + '</span>') +\n        rowInfo('Cadastro',`);
  const legacyCredit = source.indexOf("            if (act === 'add-creditos') {");
  const legacyCreditEnd = source.indexOf("            global.navigate('/admin/profissionais/'", legacyCredit);
  if (legacyCredit < 0 || legacyCreditEnd < 0) throw Error('Ação anterior de saldo não encontrada');
  source = source.slice(0, legacyCredit) + source.slice(legacyCreditEnd);
  replace("act === 'toggle-verificado' || act === 'add-creditos'", "act === 'toggle-verificado'");
  const detailStart = '  function bindProfissionalDetalhe(content, params) {';
  replace(detailStart, String.raw`  function adminProfCarteiraHtml(p) {
    return '<section class="section card stack--sm" aria-labelledby="qf-prof-carteira-titulo">' +
      '<h2 class="h3" id="qf-prof-carteira-titulo">Carteira do profissional</h2>' +
      '<p>Saldo atual <strong data-prof-saldo-atual>' + PU.formatCurrency(p.saldo || 0) + '</strong></p>' +
      '<details data-prof-carteira><summary class="btn btn--primary btn--sm">Adicionar saldo</summary>' +
      '<form class="stack--sm" data-prof-credito style="margin-top:12px">' +
        '<p class="text--sm">Adicionar à carteira de <strong>' + PU.escapeHtml(p.nome) + '</strong></p>' +
        '<label class="field"><span class="field__label">Valor em reais</span><input class="input" name="valor" inputmode="decimal" placeholder="Ex.: 20,00" required></label>' +
        '<label class="field"><span class="field__label">Motivo (opcional)</span><input class="input" name="motivo" maxlength="80" placeholder="Ex.: cortesia ou Pix recebido"></label>' +
        '<p class="text--sm" data-prof-credito-status role="status"></p>' +
        '<button class="btn btn--primary btn--sm" type="submit" data-prof-credito-confirmar>Confirmar crédito</button>' +
        '</form></details><p class="text--sm" data-prof-credito-concluido role="status"></p></section>';
  }
  const creditosPendentes = new Map();
  const creditosEmEnvio = new Set();
  function bindProfCarteira(content, id) {
    const form = content.querySelector('[data-prof-credito]');
    if (!form) return;
    const status = form.querySelector('[data-prof-credito-status]');
    const concluido = content.querySelector('[data-prof-credito-concluido]');
    const detalhes = content.querySelector('[data-prof-carteira]');
    const { valor, motivo } = form.elements;
    const confirmar = form.querySelector('[data-prof-credito-confirmar]');
    function atualizarFormulario(mensagem) {
      const lancamento = creditosPendentes.get(id);
      confirmar.disabled = creditosEmEnvio.has(id);
      valor.readOnly = motivo.readOnly = Boolean(lancamento);
      confirmar.textContent = lancamento ? 'Verificar lançamento' : 'Confirmar crédito';
      if (lancamento) {
        detalhes.open = true;
        valor.value = (lancamento.p_valor_centavos / 100).toFixed(2).replace('.', ',');
        motivo.value = lancamento.p_descricao;
      }
      status.textContent = mensagem || (lancamento ? 'Confirmação pendente. Verifique o mesmo lançamento para evitar duplicação.' : '');
    }
    function atualizarSaldo(saldo) {
      if (!form.isConnected) return;
      content.querySelectorAll('[data-prof-saldo-atual]').forEach(el => { el.textContent = PU.formatCurrency(saldo); });
    }
    atualizarFormulario();
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (creditosEmEnvio.has(id)) return;
      concluido.textContent = '';
      if (!cloudOn()) {
        status.textContent = 'Conecte-se ao painel como administrador para salvar o crédito.';
        return;
      }
      let mensagem = '';
      try {
        let lancamento = creditosPendentes.get(id);
        if (!lancamento) {
          const digitado = valor.value.trim().replace(/^R\$\s*/i, '');
          const valido = /^(?:\d+(?:[,.]\d{1,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)$/.test(digitado);
          const normalizado = digitado.includes(',') || /\.\d{3}$/.test(digitado) ? digitado.replace(/\./g, '') : digitado;
          const centavos = PU.parseCurrencyInput(normalizado);
          if (!valido || centavos <= 0 || centavos > 2147483647) {
            mensagem = 'Informe um valor válido maior que zero, como 20,00.';
            valor.focus();
            return;
          }
          lancamento = { p_user_id: id, p_valor_centavos: centavos, p_descricao: motivo.value.trim(), p_operacao_id: global.crypto.randomUUID() };
          creditosPendentes.set(id, lancamento);
        }
        creditosEmEnvio.add(id);
        atualizarFormulario('Confirmando o lançamento…');
        const result = await global.QFConnection.deadline(
          global.QFAdminCloud.client.rpc('qf_admin_creditar_carteira', lancamento), 15000, 'lançamento de saldo');
        if (result.error) throw result.error;
        if (result.data?.ok === false) {
          creditosPendentes.delete(id);
          mensagem = result.data.reason || 'Não foi possível adicionar saldo.';
          return;
        }
        const saldo = result.data?.saldo_centavos;
        if (result.data?.ok !== true || !Number.isSafeInteger(saldo)) throw Error('Saldo indisponível');
        creditosPendentes.delete(id);
        const profissional = DB.profissionalById(id);
        if (profissional) profissional.saldo = profissional.creditos = saldo;
        atualizarSaldo(saldo);
        form.reset();
        detalhes.open = false;
        concluido.textContent = 'Saldo adicionado. Novo saldo ' + PU.formatCurrency(saldo) + '.';
        detalhes.querySelector('summary').focus();
      } catch (err) {
        if (err?.code === '42501' || err?.code === 'PGRST301') {
          mensagem = 'A sessão administrativa precisa ser renovada para verificar o lançamento.';
        } else if (err?.code === 'PGRST202') {
          mensagem = 'O serviço de saldo está indisponível. Tente verificar o lançamento novamente em instantes.';
        } else if (!creditosPendentes.has(id)) {
          mensagem = 'Não foi possível iniciar o lançamento. Atualize o painel e tente novamente.';
        }
      } finally {
        creditosEmEnvio.delete(id);
        atualizarFormulario(mensagem);
      }
    });
  }
  function adminProfGestaoHtml(p) {
    const plano = adminPlanoDoProf(p.id);
    const livreVencido = plano && !plano.vigente && plano.p.plano === 'livre' &&
      Date.parse(plano.p.valido_ate) <= Date.now() && p.email;
    return '<section class="section card stack--sm" data-prof-gestao aria-labelledby="qf-prof-gestao-titulo">' +
      '<h2 class="h3" id="qf-prof-gestao-titulo">Cadastro e plano</h2>' +
      (adminPlanoHtml(p.id) || '<p class="text--sm text--secondary">Sem plano vigente.</p>') +
      '<div class="row" style="flex-wrap:wrap;gap:8px">' +
      '<button type="button" class="btn btn--outline btn--sm" data-crud-edit="profissional:' + PU.escapeHtml(p.id) + '">Editar dados</button>' +
      (plano && plano.vigente && plano.p.registro_id
        ? '<button type="button" class="btn btn--primary btn--sm" data-prof-estender>Estender plano</button>' : '') +
      (livreVencido
        ? '<button type="button" class="btn btn--primary btn--sm" data-prof-dias-livre disabled>Acrescentar dias</button>'
        : '') +
      '<button type="button" class="btn btn--outline btn--sm" data-prof-gerenciar-plano>Gerenciar plano</button>' +
      '</div>' +
      (livreVencido ? '<p class="text--sm text--secondary" data-prof-dias-status role="status">Livre vencido. Você pode liberar mais dias por cortesia.</p>'
        : plano && plano.vigente ? '' : '<p class="text--sm text--secondary">Para iniciar um plano, use Gerenciar plano.</p>') +
      '</section>';
  }
  function bindProfissionalDetalhe(content, params) {
    bindProfCarteira(content, params.id);
    const gerenciarPlano = content.querySelector('[data-prof-gerenciar-plano]');
    if (gerenciarPlano) gerenciarPlano.addEventListener('click', function () {
      admPlanoEscolha = { pro: params.id, plano: '' };
      global.navigate('/admin/planos');
    });
    const estender = content.querySelector('[data-prof-estender]');
    if (estender) estender.addEventListener('click', function () {
      const profissional = DB.profissionalById(params.id);
      const atual = adminPlanoDoProf(params.id);
      if (!profissional || !atual || !atual.vigente || !atual.p.registro_id) return;
      const plano = atual.p;
      PU.openSheet('<form id="qf-prof-estender-form" class="stack"><h3 class="sheet__title">Estender plano</h3>' +
        '<p>' + PU.escapeHtml(profissional.nome) + ' · validade atual: ' + PU.escapeHtml(PU.formatDateTime(plano.valido_ate)) + '</p>' +
        '<label class="field"><span class="field__label">Dias adicionais</span><input name="dias" class="input" type="number" min="1" max="365" step="1" required></label>' +
        '<p class="text--sm text--secondary">Os dias somam ao vencimento atual. Saldo e quantidade de chamados ficam iguais.</p>' +
        '<button type="submit" class="btn btn--primary">Confirmar extensão</button></form>');
      const form = document.getElementById('qf-prof-estender-form');
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          const r = await global.QFAdminCloud.client.rpc('qf_admin_estender_plano_profissional', {
            p_profissional: params.id, p_registro: plano.registro_id,
            p_validade_anterior: plano.valido_ate, p_dias: Number(form.elements.dias.value)
          });
          if (r.error) throw r.error;
          if (!r.data || !r.data.valido_ate) throw new Error('Não foi possível confirmar a nova validade.');
          PU.closeSheet();
          PU.toast('Plano estendido até ' + PU.formatDateTime(r.data.valido_ate) + '.', 'success');
          await recarregar('/admin/profissionais/' + params.id);
        } catch (err) {
          PU.toast(err.message || 'Não foi possível estender o plano.', 'danger');
          button.disabled = false;
        }
      });
    });`);

  // Um cadastro antigo pode não ter áreas. A alteração de outros campos não depende disso.
  replace("    const box = document.getElementById('eu-cats');",
    "    const box = document.getElementById('eu-cats');\n    const areasOriginais = val('eu-areas');\n    const cidadeOriginal = val('eu-cid');\n    const ufOriginal = val('eu-uf');");
  replace("if (!cidades.length) { PU.toast('Informe pelo menos uma cidade de atendimento.', 'danger'); b.disabled = false; return; }",
    "if (val('eu-areas') !== areasOriginais && !cidades.length) { PU.toast('Informe pelo menos uma cidade de atendimento.', 'danger'); b.disabled = false; return; }");
  replace("if (invalidas.length) { PU.toast('Cidade fora do formato Cidade/UF: ' + invalidas[0], 'danger'); b.disabled = false; return; }",
    "if (val('eu-areas') !== areasOriginais && invalidas.length) { PU.toast('Cidade fora do formato Cidade/UF: ' + invalidas[0], 'danger'); b.disabled = false; return; }");
  replace('dados.raio_km = raio; dados.cidades = cidades;',
    "dados.raio_km = raio;\n        if (val('eu-areas') !== areasOriginais) dados.cidades = cidades;\n        if (val('eu-cid') === cidadeOriginal && val('eu-uf') === ufOriginal) { delete dados.cidade; delete dados.uf; }");
  return source;
};
