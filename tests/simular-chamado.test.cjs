// V11.51: "Simular chamado" — teste do aviso de chamado no celular do profissional.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const site = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const push = fs.readFileSync(path.join(root, 'supabase', 'functions', 'quemfaz-push', 'index.ts'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-10-chamados-teste.sql'), 'utf8');

// Banco: tabela própria com RLS; profissional só altera chegou_em/confirmado_em.
assert.ok(sql.includes('create table if not exists public.chamados_teste') && sql.includes('enable row level security'));
assert.ok(sql.includes('grant update (chegou_em, confirmado_em) on public.chamados_teste to authenticated'));
assert.ok(sql.includes('using (private.qf_is_admin())') && sql.includes('using (profissional_id = auth.uid())'));
// V11.51.1: a edge function grava o teste pelo acesso interno; sem esta permissão o envio dava erro 500.
assert.ok(sql.includes('grant select, insert, update on public.chamados_teste to service_role;'));
assert.ok(!/qf_chamados|qf_carteiras|qf_movimentacoes/.test(sql.replace(/^--.*$/gm, '').replace(/references public\.qf_profissionais/g, '')), 'o teste não toca em pedidos nem carteira');

// Servidor: mesmo envio do chamado real (strong), só admin, direto para o profissional.
const i = push.indexOf('if (action === "teste_chamado")');
const bloco = push.slice(i, push.indexOf('// V11.1: registro do token do Firebase', i));
assert.ok(bloco.includes('from("qf_admins")') && bloco.includes('strong: true') && bloco.includes('tipo: "teste"') && bloco.includes('sendToUsers([proId]'));
assert.ok(!bloco.includes('qf_chamado_destinatarios_alcance') && !bloco.includes('qf_chamados'), 'ignora online/horário e não cria pedido');
assert.ok(push.includes('tipo: String(payload.tipo || "chamado")') && push.includes('teste_token: String(payload.teste_token'));

// Service worker: marca "chegou" assim que o aviso chega (app fechado) e mostra o aviso forte.
{
  const L = {}, fetches = [], shown = [];
  const self = { addEventListener: (t, f) => { L[t] = f; }, registration: { showNotification: async (t, o) => { shown.push(o); }, scope: 'https://x/' }, skipWaiting() {}, clients: { claim() {} } };
  vm.runInNewContext(sw, { self, caches: { open: async () => ({}) }, clients: { matchAll: async () => [] }, fetch: async (u, o) => { fetches.push([u, JSON.parse(o.body)]); return {}; }, URL, console, Response: function () {}, Promise, JSON });
  L.push({ data: { json: () => ({ strong: true, tipo: 'teste', teste_id: 'A', teste_token: 'B' }) }, waitUntil() {} });
  L.push({ data: { json: () => ({ strong: true, tipo: 'chamado' }) }, waitUntil() {} });
  assert.equal(fetches.length, 1);
  assert.ok(fetches[0][0].endsWith('/rest/v1/rpc/qf_teste_chegou') && fetches[0][1].p_id === 'A' && fetches[0][1].p_token === 'B');
}

// App: tela de teste com os textos pedidos e o mesmo toque do chamado.
['Chamado de teste', 'O QuemFaz está testando se o aviso de chamado chega no seu celular.', 'Não é um cliente de verdade', 'Não gasta seus créditos',
 'É só clicar no botão abaixo', 'Clique aqui para confirmar o teste', 'Teste confirmado', 'Seu celular está recebendo os chamados do QuemFaz. Quando chegar um pedido de verdade, vai tocar assim.',
 "audio=new Audio('./quemfaz_chamado.mp3');audio.loop=true", "if (payload.tipo === 'teste' && payload.teste_id && global.QFTeste)", "pattern: '/profissional/teste/:id'", "c.rpc('qf_teste_confirmar'"]
  .forEach((t) => assert.ok(site.includes(t), t));

// Painel: botão, etiquetas, resumo e atualização automática.
['Simular chamado', 'Confirmado pelo profissional', 'Chegou no aparelho, não confirmou', 'Enviado, não chegou no aparelho', 'Enviado agora, aguardando', 'Nunca testado',
 'Profissionais testados', 'Confirmados', 'Chegou e não confirmou', 'Não chegou no aparelho', 'Sem aparelho cadastrado', "action: 'teste_chamado'", '}, 5000);']
  .forEach((t) => assert.ok(admin.includes(t), t));
console.log('PASS simular chamado: banco, servidor, service worker, app e painel');

// V11.52: aviso simples para quem é da profissão quando o pedido vira "aberto a todos".
{
  const i = push.indexOf('async function notifyOpenToAll(callId: string) {');
  const bloco = push.slice(i, push.indexOf('async function progressiveNewCallPush', i));
  assert.ok(bloco.includes('qf_push_aberto_todos_destinatarios') && bloco.includes('p_evento: "aberto_todos"') && bloco.includes('strong: false'));
  assert.ok(push.includes('const openToAll = await notifyOpenToAll(call.id);') && push.includes('if (event === "aberto_todos")'));
  const sql2 = fs.readFileSync(path.join(root, 'supabase', '2026-10-10-aviso-abertos-a-todos.sql'), 'utf8');
  assert.ok(sql2.includes("e.evento in ('new_call', 'aberto_todos')") && sql2.includes('to service_role;') && sql2.includes('from public, anon, authenticated;'));
}

// V11.53: quem usa só o APK não aparece como "não chegou" (o APK 12 não informa a chegada).
assert.ok(admin.includes("rpc('qf_admin_chamados_teste')") && admin.includes('Enviado ao celular (app Android não informa a chegada)') && admin.includes('else if (soApk(t)) android++'));
assert.ok(fs.readFileSync(path.join(root, 'supabase', '2026-10-10-chamados-teste-aparelhos.sql'), 'utf8').includes("if not private.qf_is_admin() then raise exception"));

// V11.56: "Simular chamado para todos" usa o mesmo envio do teste individual, um registro por profissional.
{
  const fs2 = require('node:fs'), path2 = require('node:path'), assert2 = require('node:assert');
  const adm = fs2.readFileSync(path2.join(__dirname, '..', 'admin.html'), 'utf8');
  assert2.ok(adm.includes('data-simular-todos') && adm.includes("okLabel: 'Enviar para todos'"));
  const bloco = adm.slice(adm.indexOf('async function testeEnviarUm(proId)'), adm.indexOf('function adminCategoryName(id)'));
  assert2.ok(bloco.includes("body: { action: 'teste_chamado', profissional_id: proId }"));
  assert2.ok(bloco.includes('await PU.confirmDialog(') && bloco.indexOf('await PU.confirmDialog(') < bloco.indexOf('testeTodosRodando = true;'), 'pede confirmação antes de enviar');
  assert2.ok(bloco.includes('Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()])'));
}
