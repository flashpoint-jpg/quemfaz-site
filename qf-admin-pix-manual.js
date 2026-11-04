/* Cobrança assistida: usa as mesmas validações e confirmação bancária do cadastro. */
(function (g) {
  'use strict';
  const allowed = ['avulso', 'basico_v2', 'pro_v2', 'completo_v2'];
  const money = v => (Number(v) / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
  const client = () => g.DB?.getSession?.()?.role === 'admin' && g.QFAdminCloud?.enabled ? g.QFAdminCloud.client : null;
  const errors = {
    documento_cobranca_existente:'Já existe cobrança para este documento. Consulte o cadastro antes de gerar outra.',
    telefone_ja_cadastrado:'Este celular já está cadastrado. Confira a conta existente.',
    documento_ja_cadastrado:'Este documento já está cadastrado. Confira a conta existente.',
    email_em_uso:'Este e-mail já possui conta. Confira a carteira do profissional.',
    documento_invalido:'Confira o CPF ou CNPJ.', documento_obrigatorio:'Informe o CPF ou CNPJ.',
    email_invalido:'Confira o e-mail.', plano_invalido:'Plano indisponível. Atualize a lista.',
    preco_indisponivel:'O preço está em atualização. Tente mais tarde.',
    muitas_tentativas:'Muitas tentativas. Aguarde antes de tentar novamente.',
    cobranca_indisponivel:'A Efí não conseguiu emitir o Pix. Nenhum pagamento foi confirmado.',
    cadastro_ja_ativado:'Este pagamento já ativou uma conta. Consulte o profissional.',
    cobranca_incompativel:'Os dados da cobrança não conferem com o banco. Consulte o suporte.',
    cobranca_nao_recuperavel:'A cobrança foi cancelada ou não está disponível para pagamento. Consulte o suporte.',
    renovacao_indisponivel:'O banco não permitiu renovar o Pix vencido. Nenhum segundo Pix foi gerado.',
    consulta_indisponivel:'Não foi possível consultar a cobrança no banco. Tente novamente mais tarde.'
  };
  async function invoke(body) {
    const c = client();
    if (!c) throw Error('Entre como administrador.');
    const result = await c.functions.invoke(body.acao === 'recuperar' ? 'quemfaz-admin-recuperar-pix' : 'quemfaz-pre-cadastro', {body});
    let data = result.data;
    if (result.error) {
      try { data = await result.error.context.json(); } catch (_) {}
    }
    if (!data?.ok) throw Error(errors[data?.error] || 'Não foi possível concluir a consulta. Confira a cobrança antes de tentar novamente.');
    return data;
  }
  async function open() {
    if (!client() || document.querySelector('[data-manual-pix-dialog]')) return;
    const dialog = document.createElement('dialog');
    dialog.dataset.manualPixDialog = '';
    dialog.style.cssText = 'width:min(520px,calc(100% - 32px));max-height:90vh;overflow:auto;border:1px solid #ccd9ea;border-radius:18px;padding:22px;box-sizing:border-box;color:#183047';
    dialog.innerHTML = '<h2 style="margin-top:0">Gerar Pix manual</h2><p>Para quem ainda não concluiu o cadastro. Informe os mesmos dados que o profissional usará para criar a conta.</p>' +
      '<form style="display:grid;gap:12px" data-manual-pix-form>' +
      '<label>Nome completo<input class="input" name="nome" required maxlength="160" autocomplete="off"></label>' +
      '<label>E-mail<input class="input" type="email" name="email" required maxlength="200" autocomplete="off"></label>' +
      '<label>WhatsApp com DDD<input class="input" name="telefone" type="tel" required autocomplete="off"></label>' +
      '<label>Documento<select class="input" name="tipo_documento"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option></select></label>' +
      '<label>CPF ou CNPJ<input class="input" name="documento" required maxlength="32" autocomplete="off"></label>' +
      '<label>Plano<select class="input" name="plano" required disabled><option value="">Carregando planos…</option></select></label>' +
      '<button class="btn btn--primary" type="submit" disabled>Gerar cobrança Pix</button></form>' +
      '<p role="status" aria-live="polite"></p><section data-manual-pix-result hidden></section>' +
      '<button class="btn btn--outline" type="button" data-manual-pix-close>Fechar</button>';
    document.body.append(dialog);
    dialog.showModal();
    const form = dialog.querySelector('form'), status = dialog.querySelector('[role=status]');
    const submit = form.querySelector('[type=submit]'), plan = form.elements.plano;
    let busy = false, payment = null;
    const close = () => {
      if (busy) { status.textContent = 'Aguarde a resposta para evitar uma cobrança duplicada.'; return; }
      if (payment && !g.confirm('Copiou o código Pix e a referência? Ao fechar, você sai desta consulta.')) return;
      dialog.close(); dialog.remove();
    };
    dialog.querySelector('[data-manual-pix-close]').onclick = close;
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    form.onsubmit = async e => {
      e.preventDefault();
      if (busy || payment || !form.reportValidity()) return;
      const c = client(); if (!c) { status.textContent = 'Entre como administrador.'; return; }
      const fields = Object.fromEntries(new FormData(form));
      fields.telefone = fields.telefone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      if (!/^\d{10,11}$/.test(fields.telefone)) { status.textContent = 'Confira o WhatsApp com DDD.'; return; }
      busy = true; submit.disabled = true; status.textContent = 'Conferindo dados e gerando Pix…';
      try {
        // Previne duplicação também quando o interessado ainda não possui perfil.
        const pending = await c.rpc('qf_admin_novos_cadastros_pix');
        if (pending.error || !Array.isArray(pending.data?.itens)) throw Error('Não foi possível conferir cobranças existentes. Tente atualizar o painel.');
        const email = fields.email.trim().toLowerCase();
        const existing = pending.data.itens.filter(r => ['pendente','aprovado'].includes(r.status) &&
          (String(r.email || '').toLowerCase() === email || String(r.telefone || '').replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'') === fields.telefone));
        if (existing.length > 1) throw Error('Há mais de uma cobrança para estes dados. Confira os registros antes de continuar.');
        const data = existing.length ? await invoke({acao:'recuperar',id:existing[0].id}) : await invoke({...fields, email, acao:'criar', metodo:'pix'});
        payment = data;
        form.hidden = true;
        form.elements.documento.value = '';
        const area = dialog.querySelector('[data-manual-pix-result]'); area.hidden = false;
        area.innerHTML = '<p data-manual-pix-summary></p><label>Pix copia e cola<textarea class="input" readonly data-manual-pix-code style="width:100%;min-height:110px"></textarea></label><button type="button" class="btn btn--primary" data-manual-pix-copy>Copiar Pix</button><button type="button" class="btn btn--outline" data-manual-pix-check>Consultar pagamento</button><p>Após a confirmação bancária, o profissional precisa concluir o cadastro com o mesmo e-mail e documento. Esta cobrança não cria o perfil nem dispensa essa etapa.</p>';
        area.querySelector('[data-manual-pix-summary]').textContent = data.nome_plano + ' · ' + money(data.valor_centavos) + ' · Referência: ' + data.id;
        const linkLabel = document.createElement('label'); linkLabel.textContent = 'Link para concluir o cadastro (envie somente ao titular)';
        const link = document.createElement('textarea'); link.className = 'input'; link.readOnly = true;
        link.value = 'https://quemfazservico.com.br/#/pix-cadastro/' + encodeURIComponent(JSON.stringify({id:data.id,segredo:data.segredo,plano:data.plano,email:data.email || email}));
        link.style.cssText = 'width:100%;min-height:75px'; linkLabel.append(link); area.append(linkLabel);
        const copyLink = document.createElement('button'); copyLink.type = 'button'; copyLink.className = 'btn btn--outline'; copyLink.textContent = 'Copiar link de cadastro'; area.append(copyLink);
        copyLink.onclick = async () => { try { await g.navigator.clipboard.writeText(link.value); status.textContent = 'Link copiado. Envie somente ao titular da cobrança.'; } catch (_) { link.select(); status.textContent = 'Selecione e copie o link de cadastro.'; } };
        const code = area.querySelector('[data-manual-pix-code]'); code.value = data.pix_copy_paste || '';
        status.textContent = code.value ? 'Pix gerado. Aguardando confirmação do banco.' : 'Cobrança registrada, mas o código não foi retornado. Consulte o suporte antes de gerar outra.';
        if (data.recuperado) status.textContent = 'Cobrança existente recuperada. Aguardando confirmação bancária; nenhum segundo Pix foi criado.';
        if (data.status === 'aprovado') {
          code.parentElement.hidden = true;
          area.querySelector('[data-manual-pix-copy]').hidden = true;
          status.textContent = 'Este pagamento já está confirmado. Envie o link para concluir o cadastro. Não cobre novamente.';
        }
        area.querySelector('[data-manual-pix-copy]').onclick = async () => {
          try { await g.navigator.clipboard.writeText(code.value); status.textContent = 'Pix copiado.'; }
          catch (_) { code.select(); status.textContent = 'Selecione e copie o código Pix.'; }
        };
        area.querySelector('[data-manual-pix-check]').onclick = async function () {
          if (busy) return; busy = true; this.disabled = true;
          try {
            const result = await invoke({acao:'status', id:payment.id, segredo:payment.segredo});
            status.textContent = result.status === 'aprovado' ? 'Pagamento confirmado pelo banco. Conclua o cadastro do profissional para ativar o acesso.' : result.status === 'pendente' ? 'O banco ainda não confirmou o pagamento.' : 'Situação da cobrança: ' + result.status + '. Confira antes de tentar outro Pix.';
          } catch (error) { status.textContent = error.message; }
          finally { busy = false; this.disabled = false; }
        };
      } catch (error) { status.textContent = error.message; }
      finally { busy = false; submit.disabled = !!payment; }
    };
    try {
      const result = await client().from('qf_planos_catalogo').select('plano,nome,preco_centavos,ativo').eq('ativo', true);
      if (result.error || !Array.isArray(result.data)) throw Error('Não foi possível consultar os planos. Feche e tente novamente.');
      plan.replaceChildren();
      for (const row of result.data.filter(r => allowed.includes(r.plano)).sort((a,b) => a.preco_centavos - b.preco_centavos)) {
        const option = document.createElement('option'); option.value = row.plano; option.textContent = row.nome + ' · ' + money(row.preco_centavos); plan.append(option);
      }
      if (!plan.options.length) throw Error('Nenhum plano disponível.');
      plan.disabled = false; submit.disabled = false;
    } catch (error) { status.textContent = error.message; }
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-admin-pix-manual]')) open(); });
})(window);
