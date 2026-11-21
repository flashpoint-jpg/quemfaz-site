(function (global) {
  'use strict';
  const base = '/profissional/ferramentas';
  const statuses = { a_confirmar: 'A confirmar', confirmado: 'Confirmado', concluido: 'Concluído', cancelado: 'Cancelado' };
  const keyTypes = { cpf: 'CPF', celular: 'Celular', email: 'E-mail', aleatoria: 'Aleatória', cnpj: 'CNPJ' };
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const errorMessage = 'Não foi possível concluir. Confira sua conexão e tente novamente.';
  const site = 'https://quemfazservico.com.br';
  let noticeBusy = false;
  const checkedNotices = new Set();

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function client() {
    if (!global.QFCloud?.client) throw new Error(errorMessage);
    return global.QFCloud.client;
  }
  async function result(query) {
    const response = await query;
    if (response.error) throw new Error(errorMessage);
    return response.data;
  }
  function rpc(name, args) {
    return result(client().rpc('qf_tools_' + name, args));
  }
  function formatMoney(cents) { return money.format(cents / 100); }
  function formatDate(value) { return value.split('-').reverse().join('/'); }
  function today() {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  }
  function week() {
    const date = new Date(today() + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    const start = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return [start, date.toISOString().slice(0, 10)];
  }
  function phone(raw) {
    const value = String(raw).trim();
    if (!/^[+0-9(). -]+$/.test(value)) return '';
    let digits = value.replace(/\D/g, '');
    if ((digits.length === 10 || digits.length === 11) && !value.startsWith('+')) digits = '55' + digits;
    const ddd = Number(digits.slice(2, 4));
    const validDDD = /^(1[1-9]|2[12478]|3[1-578]|4[1-9]|5[1345]|6[1-9]|7[134579]|8[1-9]|9[1-9])$/.test(String(ddd));
    return validDDD && /^55[1-9][0-9](9[0-9]{8}|[2-5][0-9]{7})$/.test(digits) ? digits : '';
  }
  function checkedPhone(raw) {
    const number = phone(raw);
    if (!number) throw new Error('Informe um WhatsApp válido com DDD.');
    return number;
  }
  function cents(raw) {
    const normalized = String(raw).trim().replace(',', '.');
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(normalized)) return NaN;
    const [whole, fraction = ''] = normalized.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  }
  function checkedAmount(raw, min = 1) {
    const amount = cents(raw);
    if (!Number.isFinite(amount) || amount < min || amount > 10000000) throw new Error('Informe um valor válido, de até R$ 100.000,00.');
    return amount;
  }
  function checkDigits(digits, weights) {
    return weights.every((row, index) => {
      const sum = row.reduce((total, weight, i) => total + weight * Number(digits[i]), 0);
      const rest = sum % 11;
      return Number(digits[digits.length - 2 + index]) === (rest < 2 ? 0 : 11 - rest);
    });
  }
  function key(raw, type) {
    const value = String(raw).trim();
    if (type === 'email') return value.length <= 77 && /^[a-z0-9._%+~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value) ? value.toLowerCase() : '';
    if (type === 'aleatoria') return uuid.test(value) ? value.toLowerCase() : '';
    if (type === 'celular') {
      const normalized = phone(value);
      return /^55\d\d9/.test(normalized) ? '+' + normalized : '';
    }
    if (!/^[0-9./-]+$/.test(value)) return '';
    const digits = value.replace(/\D/g, '');
    if (/^(\d)\1+$/.test(digits)) return '';
    if (type === 'cpf' && digits.length === 11) {
      const rows = [9, 10].map(length => Array.from({ length }, (_, i) => length + 1 - i));
      return checkDigits(digits, rows) ? digits : '';
    }
    if (type === 'cnpj' && digits.length === 14) {
      const first = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      return checkDigits(digits, [first, [6, ...first]]) ? digits : '';
    }
    return '';
  }
  function keyType(value) {
    if (value.includes('@')) return 'email';
    if (uuid.test(value)) return 'aleatoria';
    if (value.startsWith('+')) return 'celular';
    return value.replace(/\D/g, '').length === 14 ? 'cnpj' : 'cpf';
  }
  function pixName(value, length) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length).trimEnd();
  }
  function pixCode(keyValue, holder, city, amount) {
    const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;
    const name = pixName(holder, 25);
    const place = pixName(city, 15);
    if (!name || !place) throw new Error('Confira o nome e a cidade do titular.');
    const payload = tlv('00', '01') + tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', keyValue)) +
      tlv('52', '0000') + tlv('53', '986') + tlv('54', (amount / 100).toFixed(2)) +
      tlv('58', 'BR') + tlv('59', name) + tlv('60', place) + tlv('62', tlv('05', '***')) + '6304';
    let crc = 0xffff;
    for (const char of payload) {
      crc ^= char.charCodeAt(0) << 8;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
    }
    return payload + crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function field(label, name, options = {}) {
    const { value, type = 'text', max = 100, optional, attrs = '' } = options;
    return '<label>' + label + '<input class="input" type="' + type + '" name="' + name + '" value="' + esc(value) +
      '" maxlength="' + max + '"' + (optional ? '' : ' required') + ' ' + attrs + '></label>';
  }
  function select(label, name, values, current) {
    const labelId = 'qf-tools-label-' + name;
    return '<label><span id="' + labelId + '">' + label + '</span><select class="input" aria-labelledby="' + labelId + '" name="' + name + '">' + Object.entries(values).map(([id, name]) =>
      '<option value="' + id + '"' + (current === id ? ' selected' : '') + '>' + name + '</option>').join('') + '</select></label>';
  }
  function button(label, action, secondary = false) {
    return '<button class="btn btn--' + (secondary ? 'outline' : 'primary') + '" type="button" data-tools-action="' + action + '">' + label + '</button>';
  }
  function submit(label) { return '<button class="btn btn--primary" type="submit">' + label + '</button>'; }
  function nav(label, path, secondary = false) {
    return '<button class="btn btn--' + (secondary ? 'outline' : 'primary') + '" type="button" data-nav="' + base + path + '">' + label + '</button>';
  }
  function status(text, style = '') { return '<span class="qf-tools-status ' + style + '">' + text + '</span>'; }
  function wa(label, number, message) {
    return '<a class="btn btn--outline" target="_blank" rel="noopener noreferrer" href="https://wa.me/' + esc(number) + '?text=' + encodeURIComponent(message) + '">' + label + '</a>';
  }
  function paint(root, html) {
    if (root.isConnected) root.innerHTML = html;
  }
  function message(root, text) {
    const error = root.querySelector('[data-tools-error]');
    if (error) error.textContent = text;
  }
  function form(root, inner, label, action) {
    paint(root, '<form class="qf-tools-card qf-tools-form">' + inner + '<p data-tools-error role="alert"></p>' + submit(label) + '</form>');
    const el = root.querySelector('form');
    if (!el) return;
    el.addEventListener('submit', async event => {
      event.preventDefault();
      const submitter = el.querySelector('button[type="submit"]');
      if (submitter.disabled) return;
      submitter.disabled = true;
      message(root, '');
      try { await action(Object.fromEntries(new FormData(el))); }
      catch (error) { message(root, error.message || errorMessage); }
      finally { submitter.disabled = false; }
    });
  }
  function click(root, action, callback) {
    root.querySelector('[data-tools-action="' + action + '"]')?.addEventListener('click', callback);
  }
  function go(root, suffix) {
    if (root.isConnected) global.navigate(base + suffix);
  }
  function shell() {
    return '<main class="view qf-tools" data-qf-tools><p role="status">Carregando…</p></main>';
  }
  function dashboard(root) {
    const cards = [
      ['/agenda', 'Agenda', 'Organize os serviços de hoje e da semana.', 'calendar'],
      ['/orcamentos', 'Orçamentos', 'Crie propostas e envie por mensagem.', 'quote'],
      ['/pix', 'Cobrar por Pix', 'Receba direto na sua própria chave.', 'pix'],
      ['/recibos', 'Recibos', 'Consulte pagamentos que você confirmou.', 'receipt']
    ];
    const icons = {
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4m-8 7h3m3 0h3"/>',
      quote: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
      pix: '<path d="M12 2l10 10-10 10L2 12 12 2zm-9 10h4l3 3a3 3 0 0 0 4 0l3-3h4M7 12l3-3a3 3 0 0 1 4 0l3 3"/>',
      receipt: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3zm4 5h6m-6 4h6"/>'
    };
    paint(root, '<div class="qf-tools-intro"><span class="qf-tools-free">100% grátis</span><p>Organize o seu trabalho e atenda seus próprios clientes, mesmo quando não houver pedidos novos.</p></div><div class="qf-tools-grid">' + cards.map(([path, title, detail, icon]) =>
      '<button type="button" class="qf-tools-card qf-tools-entry" data-nav="' + base + path + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">' + icons[icon] +
      '</svg><strong>' + title + '</strong><span>' + detail + '</span></button>').join('') + '</div>');
  }
  async function agenda(root, weekly) {
    const [from, to] = weekly ? week() : [today(), today()];
    paint(root, '<div class="qf-tools-row" aria-label="Período da agenda">' +
      button('Hoje', 'today', weekly) + button('Semana', 'week', !weekly) + '</div><div data-tools-agenda aria-live="polite"><p>Carregando agenda…</p></div>' + nav('Novo serviço', '/agenda/novo'));
    click(root, 'today', () => agenda(root, false));
    click(root, 'week', () => agenda(root, true));
    const list = root.querySelector('[data-tools-agenda]');
    try {
      const data = await result(client().from('qf_tools_agenda').select('*').gte('dia', from).lte('dia', to).order('dia').order('horario'));
      paint(list, data.length ? data.map(row => '<article class="qf-tools-card qf-tools-item">' +
        '<div class="qf-tools-row"><strong>' + esc(weekly ? formatDate(row.dia) + ' · ' + row.horario.slice(0, 5) : row.horario.slice(0, 5)) + '</strong>' +
        status(statuses[row.status], row.status) + '</div><h2>' + esc(row.servico) + '</h2><p>' + esc(row.cliente) + '<br>' + esc(row.endereco) + '</p><div class="qf-tools-row">' +
        nav('Editar', '/agenda/' + row.id, true) + (row.status === 'a_confirmar' || row.status === 'confirmado' ?
          wa('Enviar lembrete', row.telefone, 'Olá, ' + row.cliente + '! Seu atendimento de ' + row.servico + ' está agendado para ' + formatDate(row.dia) + ' às ' + row.horario.slice(0, 5) + '. Pode confirmar?') : '') +
        '</div></article>').join('') : '<p class="qf-tools-card">Nenhum serviço para ' + (weekly ? 'esta semana.' : 'hoje.') + '</p>');
    } catch (error) { paint(list, '<p role="alert">' + esc(error.message) + '</p>'); }
  }
  async function editAgenda(root, id) {
    const row = id ? await result(client().from('qf_tools_agenda').select('*').eq('id', id).single()) : {};
    form(root, field('Cliente', 'cliente', { value: row.cliente }) +
      field('WhatsApp do cliente', 'telefone', { type: 'tel', max: 25, value: row.telefone }) +
      field('Serviço', 'servico', { max: 140, value: row.servico }) +
      field('Endereço', 'endereco', { max: 250, value: row.endereco }) +
      '<div class="qf-tools-grid">' + field('Data', 'dia', { type: 'date', value: row.dia || today() }) +
      field('Horário', 'horario', { type: 'time', value: row.horario?.slice(0, 5) }) + '</div>' +
      select('Status', 'status', statuses, row.status), 'Salvar serviço', async data => {
        const changes = { ...data, telefone: checkedPhone(data.telefone) };
        const table = client().from('qf_tools_agenda');
        await result((id ? table.update(changes).eq('id', id) : table.insert(changes)).select('id').single());
        go(root, '/agenda');
      });
  }
  async function quotes(root) {
    const rows = await result(client().from('qf_tools_quotes').select('id,numero,cliente,total').order('numero', { ascending: false }));
    paint(root, nav('Novo orçamento', '/orcamentos/novo') + (rows.length ? rows.map(row => '<article class="qf-tools-card qf-tools-item"><strong>Orçamento nº ' + row.numero +
      '</strong><p>' + esc(row.cliente) + ' · ' + formatMoney(row.total) + '</p>' + nav('Abrir orçamento', '/orcamentos/' + row.id, true) +
      '</article>').join('') : '<p class="qf-tools-card">Você ainda não criou nenhum orçamento.</p>'));
  }
  function newQuote(root) {
    const id = crypto.randomUUID();
    form(root, field('Cliente', 'cliente') + field('WhatsApp do cliente', 'telefone', { type: 'tel', max: 25 }) +
      '<fieldset><legend>Itens do orçamento</legend><div data-tools-items></div>' + button('Adicionar item', 'add', true) + '</fieldset>' +
      field('Observações sobre material', 'material', { max: 250, optional: true }) +
      '<div class="qf-tools-grid">' + field('Validade', 'validade', { type: 'date', value: today(), attrs: 'min="' + today() + '"' }) +
      field('Prazo de execução', 'prazo', { attrs: 'placeholder="Ex.: 2 dias úteis"' }) + '</div>' +
      '<div class="qf-tools-total">Total <output data-tools-total>R$ 0,00</output></div>', 'Gerar orçamento', async data => {
      const rows = [...root.querySelectorAll('[data-tools-item]')];
      const items = rows.map(row => ({ descricao: row.querySelector('input[name="descricao"]').value.trim(),
        centavos: checkedAmount(row.querySelector('input[name="valor"]').value, 0) }));
      const total = items.reduce((acc, item) => acc + item.centavos, 0);
      if (total < 1 || total > 10000000) throw new Error('O total precisa ser maior que zero e de até R$ 100.000,00.');
      const quote = await rpc('create_quote', { p_id: id, p_cliente: data.cliente.trim(), p_telefone: checkedPhone(data.telefone),
        p_itens: items, p_material: data.material.trim(), p_validade: data.validade, p_prazo: data.prazo.trim() });
      go(root, '/orcamentos/' + quote.id);
    });
    const items = root.querySelector('[data-tools-items]');
    function update() {
      const total = [...items.querySelectorAll('input[name="valor"]')].reduce((sum, input) => sum + (cents(input.value) || 0), 0);
      root.querySelector('[data-tools-total]').textContent = formatMoney(total);
      for (const button of items.querySelectorAll('button')) button.disabled = items.children.length === 1;
      root.querySelector('[data-tools-action="add"]').disabled = items.children.length >= 30;
    }
    function add() {
      const row = document.createElement('div');
      row.className = 'qf-tools-line';
      row.dataset.toolsItem = '';
      row.innerHTML = field('Descrição', 'descricao', { max: 160 }) + field('Valor (R$)', 'valor', { max: 9, attrs: 'inputmode="decimal" placeholder="0,00"' }) +
        '<button class="btn btn--outline" type="button" aria-label="Remover item">Remover</button>';
      row.querySelector('button').onclick = () => { row.remove(); update(); };
      items.append(row);
      update();
      return row;
    }
    items.addEventListener('input', update);
    click(root, 'add', () => add().querySelector('input').focus());
    add();
  }
  async function pdf(root, name, lines, file, quoteData) {
    const btn = root.querySelector('[data-tools-action="pdf"]');
    btn.disabled = true;
    try {
      const module = await import(global.QFToolsAssets.pdf);
      if (quoteData) await module.downloadQuote(quoteData, file);
      else await module.download(name, lines, file);
    } catch (_) { message(root, 'Não foi possível baixar o PDF. Tente novamente.'); }
    finally { btn.disabled = false; }
  }
  async function quote(root, id, shared) {
    const row = shared ? (uuid.test(id) ? await rpc('public_quote', { p_token: id }) : null) :
      await result(client().from('qf_tools_quotes').select('*').eq('id', id).single());
    if (!row) {
      paint(root, '<p class="qf-tools-card">Este orçamento não foi encontrado.</p><a href="' + site + '">Ir para o QuemFaz</a>');
      return;
    }
    const title = 'Orçamento nº ' + row.numero;
    const url = site + '/#/orcamento/' + row.token;
    const share = 'Olá, ' + row.cliente + '! Segue meu orçamento de ' + formatMoney(row.total) + ': ' + url;
    const meta = ['Validade até ' + formatDate(row.validade), 'Prazo: ' + row.prazo];
    paint(root, (shared ? '<header class="qf-tools-public-head">QuemFaz Serviços</header>' : '') +
      '<article class="qf-tools-card qf-tools-document"><h1>' + title + '</h1><p>Para ' + esc(row.cliente) + '<br>Por ' + esc(row.profissional) + '</p>' +
      '<ul>' + row.itens.map(item => '<li><span>' + esc(item.descricao) + '</span><strong>' + formatMoney(item.centavos) + '</strong></li>').join('') + '</ul>' +
      (row.material ? '<p><strong>Material</strong><br>' + esc(row.material) + '</p>' : '') +
      '<div class="qf-tools-total">Total <strong>' + formatMoney(row.total) + '</strong></div><p>' + meta.map(esc).join('<br>') + '</p></article>' +
      (shared ? '<aside class="qf-tools-share"><strong>Precisa de outro serviço?</strong><p>Peça grátis e receba contatos de profissionais da sua cidade.</p><a href="' + site + '">quemfazservico.com.br</a></aside>' :
        '<div class="qf-tools-row">' + wa('Enviar no WhatsApp', row.telefone, share) + button('Baixar PDF', 'pdf', true) +
        button('Copiar link', 'copy', true) + '</div><p data-tools-error role="status"></p>'));
    click(root, 'pdf', () => pdf(root, title, [], 'orcamento-' + row.numero + '.pdf', {
      number: row.numero, customer: row.cliente, provider: row.profissional,
      validUntil: formatDate(row.validade), deadline: row.prazo, materials: row.material, total: formatMoney(row.total),
      items: row.itens.map(item => ({description:item.descricao,amount:formatMoney(item.centavos)}))
    }));
    click(root, 'copy', () => copy(root, url, 'Link copiado.'));
  }
  async function copy(root, value, success) {
    try { await navigator.clipboard.writeText(value); message(root, success); }
    catch (_) { message(root, 'Copie manualmente: ' + value); }
  }
  async function pixSetup(ownerId) {
    const [keyRow, details] = await Promise.all([
      result(client().from('qf_livre_pix_chaves').select('chave_pix,atualizado_em').eq('profissional_id', ownerId).maybeSingle()),
      result(client().from('qf_tools_pix_details').select('titular,cidade').eq('owner_id', ownerId).maybeSingle())
    ]);
    return { ...keyRow, ...details };
  }
  async function editKey(root, user) {
    const setup = await pixSetup(user.id);
    const current = setup.chave_pix || '';
    const types = current && keyType(current) === 'cnpj' ? keyTypes : { cpf: 'CPF', celular: 'Celular', email: 'E-mail', aleatoria: 'Aleatória' };
    form(root, '<p>Use a chave da sua própria conta. Confira os dados antes de salvar.</p>' +
      select('Tipo de chave', 'tipo', types, current ? keyType(current) : 'cpf') +
      field('Chave Pix', 'chave', { value: current, max: 100, attrs: 'autocomplete="off" autocapitalize="off"' }) +
      field('Nome do titular', 'titular', { value: setup.titular || user.nome }) +
      field('Cidade do titular', 'cidade', { value: setup.cidade || user.cidade }), 'Salvar chave', async data => {
        const normalized = key(data.chave, data.tipo);
        if (!normalized) throw new Error('Chave inválida. Confira o tipo e o valor informado.');
        if (!pixName(data.titular, 25) || !pixName(data.cidade, 15)) throw new Error('Confira o nome e a cidade do titular.');
        if (current && current !== normalized && !global.confirm('Alterar sua chave Pix? Confira a chave antes de continuar.')) return;
        await rpc('save_pix', { p_key: normalized, p_name: data.titular.trim(), p_city: data.cidade.trim() });
        go(root, '/pix');
      });
  }
  async function charges(root, receiptsOnly) {
    let query = client().from('qf_tools_charges').select('id,cliente,descricao,valor,recebido_em,numero_recibo');
    if (receiptsOnly) query = query.not('recebido_em', 'is', null);
    const rows = await result(query.order('criado_em', { ascending: false }));
    paint(root, (receiptsOnly ? '' : '<div class="qf-tools-row">' + nav('Nova cobrança', '/pix/nova') + nav('Minha chave Pix', '/pix/chave', true) + '</div>') +
      (rows.length ? rows.map(row => '<article class="qf-tools-card qf-tools-item"><div class="qf-tools-row"><strong>' + esc(row.descricao) +
      '</strong>' + (row.recebido_em ? status('Recebido', 'confirmado') : status('Pendente')) + '</div><p>' + esc(row.cliente) + ' · ' +
      formatMoney(row.valor) + '</p>' + nav(row.recebido_em ? 'Ver recibo' : 'Ver cobrança', (row.recebido_em ? '/recibos/' : '/pix/') + row.id, true) +
      '</article>').join('') : '<p class="qf-tools-card">' + (receiptsOnly ? 'Nenhum pagamento confirmado ainda.' : 'Você ainda não criou nenhuma cobrança.') + '</p>'));
  }
  async function newCharge(root, user) {
    const setup = await pixSetup(user.id);
    if (!setup.chave_pix || !key(setup.chave_pix, keyType(setup.chave_pix)) || !setup.titular || !setup.cidade) {
      paint(root, '<div class="qf-tools-card"><p>Confira a sua chave Pix e informe os dados do titular antes de gerar a cobrança.</p>' +
        nav('Configurar minha chave', '/pix/chave') + '</div>');
      return;
    }
    const id = crypto.randomUUID();
    form(root, field('Cliente', 'cliente') + field('WhatsApp do cliente', 'telefone', { type: 'tel', max: 25 }) +
      field('Descrição do serviço', 'descricao', { max: 160 }) +
      field('Valor (R$)', 'valor', { max: 9, attrs: 'inputmode="decimal" placeholder="0,00"' }), 'Gerar cobrança', async data => {
        const changes = { id, cliente: data.cliente.trim(), telefone: checkedPhone(data.telefone), descricao: data.descricao.trim(),
          valor: checkedAmount(data.valor), titular: setup.titular, cidade: setup.cidade, chave_versao: setup.atualizado_em };
        const saved = await client().from('qf_tools_charges').insert(changes);
        if (saved.error && saved.error.code !== '23505') throw new Error(errorMessage);
        go(root, '/pix/' + id);
      });
  }
  function receipt(root, row) {
    const title = 'Recibo nº ' + row.numero_recibo;
    const date = new Date(row.recebido_em).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const brand = 'Recibo gerado pelo QuemFaz · quemfazservico.com.br';
    paint(root, '<article class="qf-tools-card qf-tools-document"><h1>' + title + '</h1>' + status('Recebido', 'confirmado') +
      '<p>Recebido de <strong>' + esc(row.cliente) + '</strong> por ' + esc(row.titular) + ' em ' + date + '.</p><p>' + esc(row.descricao) +
      '</p><div class="qf-tools-total">Valor <strong>' + formatMoney(row.valor) + '</strong></div><p>Confirmado pelo profissional</p>' +
      '<small>' + brand + '</small></article>' + button('Baixar PDF', 'pdf', true) + '<p data-tools-error role="status"></p>');
    click(root, 'pdf', () => pdf(root, title, ['Recebido de ' + row.cliente + ' por ' + row.titular + ' em ' + date, row.descricao,
      'Valor: ' + formatMoney(row.valor), 'Confirmado pelo profissional', brand], 'recibo-' + row.numero_recibo + '.pdf'));
  }
  async function charge(root, id, receiptOnly, user) {
    const row = await result(client().from('qf_tools_charges').select('*').eq('id', id).single());
    if (row.recebido_em) return receipt(root, row);
    if (receiptOnly) { paint(root, '<p class="qf-tools-card">Esta cobrança ainda está pendente.</p>'); return; }
    const setup = await pixSetup(user.id);
    const pixKey = key(setup.chave_pix || '', keyType(setup.chave_pix || ''));
    const current = pixKey && setup.atualizado_em === row.chave_versao;
    const code = current ? pixCode(pixKey, row.titular, row.cidade, row.valor) : '';
    paint(root, '<article class="qf-tools-card qf-tools-document"><h1>Cobrança Pix</h1>' + status('Pendente') + '<p>' +
      esc(row.cliente) + ' · ' + esc(row.descricao) + '</p><div class="qf-tools-total">Valor <strong>' + formatMoney(row.valor) + '</strong></div>' +
      (current ? '<canvas class="qf-tools-qr" aria-label="QR Code para pagamento Pix"></canvas><p data-tools-qr-error role="status"></p>' +
        '<label><span id="qf-tools-pix-label">Pix copia e cola</span><textarea class="input" aria-labelledby="qf-tools-pix-label" readonly rows="3">' + esc(code) + '</textarea></label><div class="qf-tools-row">' +
        wa('Enviar Pix no WhatsApp', row.telefone, 'Olá, ' + row.cliente + '! Segue o Pix de ' + formatMoney(row.valor) + ' para ' +
          row.descricao + '.\n\n' + code) + button('Copiar código', 'copy', true) + '</div>' :
        '<p>A chave Pix foi alterada. Gere uma nova cobrança se ainda precisar enviar o código.</p>') +
      '<p>Confira o recebimento no seu banco antes de confirmar.</p>' + button('Marcar como recebido', 'receive') +
      '<p data-tools-error role="status"></p></article>');
    if (current) import(global.QFToolsAssets.qr).then(async module => {
      const canvas = root.querySelector('canvas');
      if (canvas) {
        await module.draw(canvas, code);
        canvas.dataset.ready = 'true';
      }
    }).catch(() => {
      const info = root.querySelector('[data-tools-qr-error]');
      if (info) info.textContent = 'QR Code indisponível. Use o Pix copia e cola.';
    });
    click(root, 'copy', () => copy(root, code, 'Código Pix copiado.'));
    click(root, 'receive', async event => {
      if (!global.confirm('Você conferiu no seu banco que este Pix foi recebido?')) return;
      event.target.disabled = true;
      try {
        await rpc('receive_charge', { p_id: id });
        go(root, '/recibos/' + id);
      } catch (error) { message(root, error.message); event.target.disabled = false; }
    });
  }
  async function mount(pattern, content, params, user) {
    const root = content.querySelector('[data-qf-tools]');
    if (!root) return;
    const route = pattern.startsWith(base) ? pattern.slice(base.length) : pattern;
    try {
      switch (route) {
        case '': return dashboard(root);
        case '/agenda': return await agenda(root, false);
        case '/agenda/novo': return await editAgenda(root);
        case '/agenda/:id': return await editAgenda(root, params.id);
        case '/orcamentos': return await quotes(root);
        case '/orcamentos/novo': return newQuote(root);
        case '/orcamentos/:id': return await quote(root, params.id, false);
        case '/orcamento/:token': return await quote(root, params.token, true);
        case '/pix': return await charges(root, false);
        case '/pix/chave': return await editKey(root, user);
        case '/pix/nova': return await newCharge(root, user);
        case '/pix/:id': return await charge(root, params.id, false, user);
        case '/recibos': return await charges(root, true);
        case '/recibos/:id': return await charge(root, params.id, true, user);
      }
    } catch (error) {
      paint(root, '<p class="qf-tools-card" role="alert">' + esc(error.message || errorMessage) + '</p>' +
        button('Tentar novamente', 'retry', true));
      click(root, 'retry', () => mount(pattern, content, params, user));
    }
  }
  async function showNotice(user) {
    if (!user?.id || checkedNotices.has(user.id) || noticeBusy || !global.QFAvisoGeral) return;
    if (document.querySelector('#qf-aviso-overlay, .qf-call-overlay')) return;
    noticeBusy = true;
    try {
      const show = await rpc('notice', { p_action: 'visualizar' });
      checkedNotices.add(user.id);
      if (!show || document.querySelector('#app-shell')?.dataset.role !== 'profissional') return;
      global.QFAvisoGeral.show({
        id: 'ferramentas-profissional',
        titulo: 'Nova ferramenta para o seu dia a dia',
        mensagem: 'Agende serviços, envie orçamentos, cobre com seu Pix e gere recibos. Tudo grátis, inclusive para seus próprios clientes.',
        tools: true
      });
    } catch (_) { /* Uma nova abertura tenta consultar de novo. */ }
    finally { noticeBusy = false; }
  }
  async function noticeClick() {
    await rpc('notice', { p_action: 'experimentar' });
    global.navigate(base + '/agenda');
  }

  global.QFTools = { shell, mount, showNotice, noticeClick, validation: { cents, phone, key, pixCode } };
})(window);
