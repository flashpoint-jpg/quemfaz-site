const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const admin = fs.readFileSync(require('node:path').join(__dirname, '..', 'admin.html'), 'utf8');
const push = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/functions/quemfaz-push/index.ts'), 'utf8');

test('simulador do admin exige sessão Supabase válida antes de enviar aviso', () => {
  assert.match(admin, /async function testeValidarSessao\(\)/);
  assert.match(admin, /await cl\.auth\.getSession\(\)/);
  assert.match(admin, /await cl\.auth\.getUser\(\)/);
  assert.match(admin, /const cl = await testeValidarSessao\(\);[\s\S]{0,160}cl\.functions\.invoke\('quemfaz-push'/);
  assert.match(admin, /try \{ await testeValidarSessao\(\); \}[\s\S]{0,170}catch/);
  assert.match(admin, /if \(status === 401\)/);
  assert.match(admin, /if \(status === 403\)/);
});

test('a Edge Function mantém autenticação e permissão administrativa no envio de teste', () => {
  assert.match(push, /const user = await getUser\(req\)/);
  assert.match(push, /if \(!user\) return json\(\{ error: "unauthorized" \}, 401\)/);
  assert.match(push, /if \(action === "teste_chamado"\)/);
  assert.match(push, /if \(!isAdmin\) return json\(\{ error: "forbidden" \}, 403\)/);
});
