const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { chromium, devices } = require('playwright');
const jsQR = require('jsqr');

const root = path.resolve(__dirname, '../dist');
const migrations = path.resolve(__dirname, '../supabase/migrations');
const migration = path.join(migrations, fs.readdirSync(migrations).find(file => file.endsWith('_ferramentas_profissional.sql')));
const pixMigration = path.resolve(__dirname, '../supabase/migrations/20261028044500_chave_pix_perfil_existente.sql');
const output = process.env.QF_SCREENSHOTS || null;
const a = randomUUID();
const b = randomUUID();
const admin = randomUUID();
const customer = randomUUID();
const types = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://localhost').pathname.replace(/^\/$/, '/index.html'));
  if (!file.startsWith(root + '/')) return res.writeHead(403).end();
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end();
    res.setHeader('content-type', types[path.extname(file)] || 'text/html');
    res.end(data);
  });
});

async function fixture(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema private;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to anon, authenticated;
    create table public.qf_profiles (
      id uuid primary key, tipo text, nome text, nome_fantasia text, ativo boolean default true
    );
    create table public.qf_profissionais (user_id uuid primary key);
    create table public.qf_avisos_gerais (
      id uuid primary key default gen_random_uuid(), titulo text, mensagem text, publico text, ativo boolean
    );
    create table public.qf_avisos_gerais_leituras (
      aviso_id uuid references public.qf_avisos_gerais, user_id uuid, lido_em timestamptz default now(),
      primary key (aviso_id,user_id)
    );
    alter table public.qf_avisos_gerais enable row level security;
    alter table public.qf_avisos_gerais_leituras enable row level security;
    create function private.qf_is_admin() returns boolean language sql as $$
      select auth.uid() = '${admin}'::uuid;
    $$;
    insert into auth.users values ('${a}'),('${b}'),('${admin}'),('${customer}');
    insert into public.qf_profissionais values ('${a}'),('${b}');
    insert into public.qf_profiles (id,tipo,nome) values
      ('${a}','profissional','Carlos Teste'),('${b}','profissional','Maria Teste'),
      ('${admin}','admin','Admin Teste'),('${customer}','cliente','Cliente Teste');
    insert into public.qf_avisos_gerais (titulo,publico,ativo) values ('Aviso já publicado','todos',true);
  `);
  await db.exec(fs.readFileSync(pixMigration, 'utf8'));
  await db.exec(fs.readFileSync(migration, 'utf8'));
}

function sqlFor(db, uid, query, params = []) {
  return db.transaction(async tx => {
    await tx.exec('set local role ' + (uid ? 'authenticated' : 'anon'));
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [uid || '']);
    return tx.query(query, params);
  });
}

const tableNames = new Set(['qf_tools_agenda', 'qf_tools_quotes', 'qf_tools_charges', 'qf_tools_pix_details', 'qf_livre_pix_chaves']);
function identifier(value) {
  if (value === '*') return value;
  assert.match(value, /^[a-z][a-z0-9_]*$/);
  return '"' + value + '"';
}
function rpcInput(name, args) {
  const signatures = {
    create_quote: ['p_id', 'p_cliente', 'p_telefone', 'p_itens', 'p_material', 'p_validade', 'p_prazo'],
    public_quote: ['p_token'], save_pix: ['p_key', 'p_name', 'p_city'],
    receive_charge: ['p_id'], notice: ['p_action'], notice_report: []
  };
  const signature = signatures[name];
  assert.ok(signature);
  return signature.map(key => key === 'p_itens' ? JSON.stringify(args[key]) : args[key]);
}
async function proxy(db, uid, req) {
  try {
    if (req.rpc) {
      const name = req.rpc.replace(/^qf_tools_/, '');
      const params = rpcInput(name, req.args);
      const response = await sqlFor(db, uid, 'select public.' + identifier(req.rpc) + '(' +
        params.map((_, i) => '$' + (i + 1)).join(',') + ') as result', params);
      return { data: response.rows[0].result, error: null };
    }
    assert.ok(tableNames.has(req.table));
    const table = 'public.' + identifier(req.table);
    const params = [];
    const arg = value => { params.push(value); return '$' + params.length; };
    const where = () => req.filters.length ? ' where ' + req.filters.map(([column, op, value]) =>
      identifier(column) + ({ eq: ' = ', gte: ' >= ', lte: ' <= ', present: ' is not null' })[op] +
      (op === 'present' ? '' : arg(value))).join(' and ') : '';
    const fields = (req.fields || '*').split(',').map(identifier).join(',');
    let query;
    if (req.method === 'insert') {
      query = 'insert into ' + table + ' (' + Object.keys(req.payload).map(identifier).join(',') + ') values (' +
        Object.values(req.payload).map(arg).join(',') + ')' + (req.fields ? ' returning ' + fields : '');
    } else if (req.method === 'update') {
      query = 'update ' + table + ' set ' + Object.entries(req.payload).map(([key, value]) => identifier(key) + '=' + arg(value)).join(',') +
        where() + ' returning ' + fields;
    } else {
      query = 'select ' + fields + ' from ' + table + where();
      if (req.order.length) query += ' order by ' + req.order.map(([key, ascending]) => identifier(key) + (ascending ? ' asc' : ' desc')).join(',');
    }
    const { rows } = await sqlFor(db, uid, query, params);
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof Date) row[key] = ['dia', 'validade'].includes(key) ? value.toISOString().slice(0, 10) : value.toISOString();
      }
    }
    if (req.one && (rows.length > 1 || (req.one === 'one' && rows.length !== 1))) return { error: { code: 'PGRST116' } };
    return { data: req.one ? rows[0] || null : rows, error: null };
  } catch (error) { return { error: { code: error.code || 'SQL', message: error.message } }; }
}

async function setupPage(context, db, uid, url, signup = false) {
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(7500);
  await page.exposeFunction('__toolsDatabase', req => proxy(db, uid, req));
  await page.goto(url + '/?demo=1' + (signup ? '#/auth/profissional/cadastro' : ''));
  await page.waitForFunction(() => window.navigate && window.DB && window.QFTools);
  await page.evaluate(userId => {
    QFCloud.enabled = false;
    QFPush.needsPermission = () => false;
    QFPush.isActive = () => true;
    QFPush.refreshStatus = async () => true;
    QFCloud.client = {
      rpc(name, args = {}) {
        return name.startsWith('qf_tools_') ? window.__toolsDatabase({ rpc: name, args }) : Promise.resolve({ data: null, error: null });
      },
      from(table) {
        const request = { table, filters: [], order: [], method: 'select' };
        return {
          select(fields) { request.fields = fields; return this; },
          insert(payload) { request.method = 'insert'; request.payload = payload; return this; },
          update(payload) { request.method = 'update'; request.payload = payload; return this; },
          eq(key, value) { request.filters.push([key, 'eq', value]); return this; },
          gte(key, value) { request.filters.push([key, 'gte', value]); return this; },
          lte(key, value) { request.filters.push([key, 'lte', value]); return this; },
          not(key) { request.filters.push([key, 'present']); return this; },
          order(key, options) { request.order.push([key, options?.ascending !== false]); return this; },
          single() { request.one = 'one'; return this; },
          maybeSingle() { request.one = 'maybe'; return this; },
          then(resolve, reject) { return window.__toolsDatabase(request).then(resolve, reject); }
        };
      }
    };
    if (userId) {
      DB.resetDemoData();
      const demo = DB.state.users.profissionais.find(user => user.id === 'pro_carlos');
      demo.id = userId;
      DB.setSession({ role: 'profissional', userId });
      navigate('/profissional/home', true);
    }
  }, uid);
  return page;
}
async function visible(page, text) { try { await page.getByText(text, { exact: true }).first().waitFor({timeout:6000}); } catch (error) { console.error(page.url(), (await page.locator('#app-content').innerText()).slice(0,3000)); throw error; } }
async function click(page, label) { await page.getByRole('button', { name: label, exact: true }).first().click(); }
async function shot(page, name) {
  if (!output) return;
  fs.mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, name + '.png') });
}
async function fill(page, label, value) { await page.getByLabel(label, { exact: true }).fill(value); }

(async () => {
  const db = await PGlite.create();
  await fixture(db);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.QF_CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--single-process', '--no-zygote', '--disable-dev-shm-usage', '--disable-gpu'] });
  try {
    const mobile = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block', acceptDownloads: true });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const register = await setupPage(desktop, db, null, url, true);
    await visible(register, 'O QuemFaz também ajuda você nos dias sem pedidos novos');
    await shot(register, 'cadastro-desktop');

    const pro = await setupPage(mobile, db, a, url);
    await visible(pro, 'Nova ferramenta para o seu dia a dia');
    await shot(pro, 'aviso-celular');
    await click(pro, 'Experimentar agora');
    await visible(pro, 'Nenhum serviço para hoje.');
    await click(pro, 'Novo serviço');
    await fill(pro, 'Cliente', 'Mariana Teste');
    await fill(pro, 'WhatsApp do cliente', '11912345678');
    await fill(pro, 'Serviço', 'Pintura de quarto');
    await fill(pro, 'Endereço', 'Rua de Teste, 100');
    await fill(pro, 'Horário', '09:00');
    await click(pro, 'Salvar serviço');
    await visible(pro, 'Pintura de quarto');
    await click(pro, 'Semana');
    await visible(pro, 'Pintura de quarto');
    await click(pro, 'Editar');
    await pro.locator('[data-qf-tools] form').waitFor();
    await pro.getByLabel('Status', { exact: true }).selectOption('confirmado');
    await click(pro, 'Salvar serviço');
    await visible(pro, 'Confirmado');
    assert.match(await pro.getByRole('link', { name: 'Enviar lembrete' }).getAttribute('href'), /wa\.me\/5511912345678\?text=/);
    await shot(pro, 'agenda-celular');

    await click(pro, 'Ferramentas');
    await visible(pro, '100% grátis');
    await shot(pro, 'ferramentas-celular');
    await pro.locator('[data-nav="/profissional/ferramentas/orcamentos"]').click();
    await click(pro, 'Novo orçamento');
    await fill(pro, 'Cliente', 'Mariana Teste');
    await fill(pro, 'WhatsApp do cliente', '123');
    await fill(pro, 'Descrição', 'Pintura de quarto');
    await fill(pro, 'Valor (R$)', '450,50');
    await fill(pro, 'Prazo de execução', '2 dias úteis');
    await click(pro, 'Gerar orçamento');
    await visible(pro, 'Informe um WhatsApp válido com DDD.');
    await fill(pro, 'WhatsApp do cliente', '11912345678');
    await click(pro, 'Adicionar item');
    await pro.getByLabel('Descrição', { exact: true }).nth(1).fill('Material');
    await pro.getByLabel('Valor (R$)', { exact: true }).nth(1).fill('199,50');
    assert.match(await pro.locator('[data-tools-total]').textContent(), /650,00/);
    await click(pro, 'Gerar orçamento');
    await visible(pro, 'Orçamento nº 1');
    const download = pro.waitForEvent('download');
    await click(pro, 'Baixar PDF');
    const file = await download;
    assert.equal(file.suggestedFilename(), 'orcamento-1.pdf');
    assert.equal(fs.readFileSync(await file.path()).subarray(0, 5).toString(), '%PDF-');
    const share = await pro.getByRole('link', { name: 'Enviar no WhatsApp' }).getAttribute('href');
    const token = decodeURIComponent(share).split('/#/orcamento/').at(-1);
    assert.match(token, /^[a-f0-9-]{36}$/);
    const visitor = await setupPage(desktop, db, null, url);
    await visitor.evaluate(token => navigate('/orcamento/' + token, true), token);
    await visible(visitor, 'Orçamento nº 1');
    await visible(visitor, 'Precisa de outro serviço?');
    assert.equal(await visitor.locator('body').getByText('11912345678').count(), 0);
    await shot(visitor, 'orcamento-publico-desktop');

    await pro.evaluate(() => navigate('/profissional/ferramentas/pix/chave', true));
    await fill(pro, 'Chave Pix', '11111111111');
    await fill(pro, 'Nome do titular', 'Carlos Teste');
    await fill(pro, 'Cidade do titular', 'Santo André');
    await click(pro, 'Salvar chave');
    await visible(pro, 'Chave inválida. Confira o tipo e o valor informado.');
    await pro.getByLabel('Tipo de chave').selectOption('email');
    await fill(pro, 'Chave Pix', 'pix@example.invalid');
    await click(pro, 'Salvar chave');
    await click(pro, 'Nova cobrança');
    await fill(pro, 'Cliente', 'Mariana Teste');
    await fill(pro, 'WhatsApp do cliente', '11912345678');
    await fill(pro, 'Descrição do serviço', 'Pintura de quarto');
    await fill(pro, 'Valor (R$)', '650,00');
    await click(pro, 'Gerar cobrança');
    await visible(pro, 'Pendente');
    try { await pro.locator('.qf-tools-qr[data-ready]').waitFor(); } catch (error) {
      console.error(await pro.locator('[data-qf-tools]').innerText());
      throw error;
    }
    const pixels = await pro.locator('.qf-tools-qr').evaluate(el => ({
      width: el.width, height: el.height, data: [...el.getContext('2d').getImageData(0, 0, el.width, el.height).data]
    }));
    const qr = jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height);
    assert.ok(qr);
    const code = await pro.getByLabel('Pix copia e cola', { exact: true }).inputValue();
    assert.equal(qr.data, code);
    assert.match(code, /br\.gov\.bcb\.pix0119pix@example\.invalid/);
    assert.match(code, /5406650\.00/);
    let crc = 0xffff;
    for (const byte of Buffer.from(code.slice(0, -4))) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) && 0x1021)) & 0xffff;
    }
    assert.equal(code.slice(-4), crc.toString(16).toUpperCase().padStart(4, '0'));
    await shot(pro, 'cobranca-pix-celular');
    pro.once('dialog', dialog => dialog.dismiss());
    await click(pro, 'Marcar como recebido');
    await visible(pro, 'Pendente');
    pro.once('dialog', dialog => dialog.accept());
    await click(pro, 'Marcar como recebido');
    await visible(pro, 'Recibo nº 1');
    await visible(pro, 'Confirmado pelo profissional');
    await shot(pro, 'recibo-celular');

    const reopened = await setupPage(await browser.newContext({ serviceWorkers: 'block' }), db, a, url);
    await reopened.locator('.tabbar [data-nav="/profissional/ferramentas"]').waitFor();
    assert.equal(await reopened.getByText('Nova ferramenta para o seu dia a dia', { exact: true }).count(), 0);
    const report = (await sqlFor(db, admin, 'select public.qf_tools_notice_report() as value')).rows[0].value;
    assert.equal(report.length, 1);
    assert.equal(report[0].user_id, a);
    assert.ok(report[0].visto && report[0].clicou);
    await assert.rejects(sqlFor(db, b, 'select public.qf_tools_notice_report()'), /administrador/);
    for (const table of tableNames) {
      assert.equal((await sqlFor(db, b, 'select * from public.' + identifier(table))).rows.length, 0, table);
    }
    const chargeId = (await sqlFor(db, a, 'select id from public.qf_tools_charges')).rows[0].id;
    await assert.rejects(sqlFor(db, b, 'select public.qf_tools_receive_charge($1)', [chargeId]), /não encontrada/);
    assert.equal((await sqlFor(db, a, 'select public.qf_tools_receive_charge($1) as value', [chargeId])).rows[0].value.numero_recibo, 1);
    await assert.rejects(sqlFor(db, null, 'select * from public.qf_tools_quotes'), /permission denied/);
    await assert.rejects(sqlFor(db, a, "select public.qf_tools_save_pix('11111111111','Carlos','SP')"), /dígitos/);
    await assert.rejects(sqlFor(db, customer, "select public.qf_tools_save_pix('x@y.zz','Cliente','SP')"), /profissionais/);
    const publicRow = (await sqlFor(db, null, 'select public.qf_tools_public_quote($1) as value', [token])).rows[0].value;
    assert.equal(publicRow.total, 65000);
    assert.deepEqual(Object.keys(publicRow).sort(), ['cliente','criado_em','itens','material','numero','prazo','profissional','total','validade'].sort());
    assert.equal((await db.query("select ativo from public.qf_avisos_gerais where titulo='Aviso já publicado'")).rows[0].ativo, true);
    console.log('PASS: cadastro, agenda, orçamento público e PDF, chave inválida/válida, QR decodificado, recibo, aviso único e isolamento entre profissionais.');
  } finally {
    await browser.close();
    server.close();
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
