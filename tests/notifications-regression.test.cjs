const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('/* QuemFaz — Web Push real'), html.indexOf('/* QuemFaz — endereço nacional'));

function setup({ native = false, granted = true, subscription = true, saved = true, failServer = false } = {}) {
  const storage = new Map(saved ? [['qf_push_enabled', '1'], ['qf_fcm_token', 'device-token']] : []);
  const counts = { prompts: 0, subscriptions: 0, registrations: 0, events: 0 };
  const listeners = {};
  const permission = { value: granted ? 'granted' : 'denied' };
  const vapid = source.match(/VAPID_PUBLIC_KEY = '([^']+)'/)[1];
  const sub = { options: { applicationServerKey: Uint8Array.from(Buffer.from(vapid, 'base64url')).buffer }, toJSON: () => ({ endpoint: 'https://push.example/device' }) };
  const reg = { pushManager: { getSubscription: async () => subscription ? sub : null, subscribe: async () => { counts.subscriptions++; return sub; } } };
  const plugin = {
    checkPermissions: async () => { await new Promise(r => setTimeout(r, 15)); return { receive: permission.value }; },
    requestPermissions: async () => { counts.prompts++; return { receive: permission.value }; },
    addListener: (name, fn) => { listeners[name] = fn; },
    register: async () => { counts.registrations++; queueMicrotask(() => listeners.registration({ value: 'device-token' })); }
  };
  const Notification = { get permission() { return permission.value; }, requestPermission: async () => { counts.prompts++; return permission.value; } };
  const window = {
    isSecureContext: true, PushManager: function () {}, Notification,
    QFCloud: { projectUrl: 'https://api.example', client: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-session' } } }) } } },
    dispatchEvent() { counts.events++; }
  };
  if (native) window.Capacitor = { isNativePlatform: () => true, Plugins: { PushNotifications: plugin } };
  const scope = { window, Notification, navigator: { serviceWorker: { getRegistration: async () => reg, register: async () => reg, ready: Promise.resolve(reg) } },
    location: { protocol: 'https:' }, document: { addEventListener() {} },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    fetch: async () => ({ ok: !failServer, json: async () => ({ ok: !failServer, fcm_ready: true }) }),
    atob: s => Buffer.from(s, 'base64').toString('binary'), Uint8Array, CustomEvent: class {},
    setTimeout, clearTimeout, console };
  vm.runInNewContext(source, scope);
  return { push: window.QFPush, counts, storage, permission };
}

async function run() {
  const native = setup({ native: true });
  assert.equal(native.push.needsPermission(), false, 'Não pede permissão enquanto consulta o Android');
  await native.push.refreshStatus();
  assert.equal(native.push.isActive(), true, 'Permissão nativa e registro persistido são reconhecidos ao abrir');
  await Promise.all([native.push.restore(), native.push.restore()]);
  assert.equal(native.counts.registrations, 1, 'Restaurações simultâneas compartilham a mesma operação');
  assert.equal(native.counts.prompts, 0, 'Não pede novamente uma permissão nativa concedida');

  const web = setup();
  await web.push.refreshStatus();
  assert.equal(web.push.isActive(), true);
  assert.equal(await web.push.restore(), true);
  assert.equal(web.counts.prompts, 0, 'Restauração web não chama requestPermission');
  assert.equal(web.counts.subscriptions, 0, 'Reutiliza a inscrição existente');
  web.permission.value = 'denied';
  await web.push.refreshStatus();
  assert.equal(web.push.isActive(), false, 'Revogação não é ocultada por uma marca antiga');
  assert.equal(web.push.needsPermission(), true);

  const lostSubscription = setup({ subscription: false });
  await lostSubscription.push.refreshStatus();
  assert.equal(lostSubscription.push.isActive(), false, 'Sem inscrição não afirma que o push está ativo');
  assert.equal(lostSubscription.push.needsPermission(), false, 'Permissão concedida não vira pedido de ativação');
  assert.equal(await lostSubscription.push.restore(), true);
  assert.equal(lostSubscription.push.isActive(), true);
  assert.equal(lostSubscription.counts.subscriptions, 1);
  assert.equal(lostSubscription.counts.prompts, 0);

  const offline = setup({ saved: false, failServer: true });
  assert.equal(await offline.push.restore(), false);
  assert.equal(offline.push.isActive(), false, 'Falha no servidor não confirma registro');
  assert.equal(offline.push.needsPermission(), false, 'Falha de conexão não se confunde com falta de permissão');
  assert.match(offline.push.card('cliente'), /Reconectar avisos/);
  console.log('PASS: permissão nativa, restauração sem novos prompts, inscrição expirada, revogação e falha de conexão.');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
