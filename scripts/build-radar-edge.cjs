'use strict';
// Gera supabase/functions/qf-radar-coleta/index.ts a partir dos mesmos módulos testados (classificador, intake, conectores, executor).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const mods = {
  './radar-leads-classifier.cjs': rd('qf-radar-classifier.js'),
  './radar-leads-intake.cjs': rd('scripts/radar-leads-intake.cjs'),
  './radar-leads-connectors.cjs': rd('scripts/radar-leads-connectors.cjs'),
  './radar-leads-run.cjs': rd('scripts/radar-leads-run.cjs').replace(/if \(require\.main === module\)[^\n]*\n/, '')
};
let out = '// @ts-nocheck\n// GERADO por scripts/build-radar-edge.cjs — não editar à mão.\n// Coleta automática do Radar de Leads Externos (só fontes habilitadas e autorizadas em qf_lead_sources).\n';
out += 'const __defs: Record<string, (module: any, exports: any, require: any) => void> = {};\nconst __cache: Record<string, any> = {};\nconst __req = (k: string) => { if (!__cache[k]) { const m = { exports: {} }; __cache[k] = m; __defs[k](m, m.exports, __req); } return __cache[k].exports; };\n';
for (const [k, src] of Object.entries(mods)) out += `__defs[${JSON.stringify(k)}] = (module, exports, require) => {\n${src}\n};\n`;
out += `
const run = __req('./radar-leads-run.cjs');
Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') return new Response('metodo', { status: 405 });
  const url = new URL(req.url);
  const env = { SUPABASE_URL: Deno.env.get('SUPABASE_URL'), SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') };
  const argv = [];
  if (url.searchParams.get('dry_run') === '1') argv.push('--dry-run');
  // A função respeita o intervalo mínimo de cada fonte; --force só vale para dry-run (não grava nada).
  if (url.searchParams.get('force') === '1' && url.searchParams.get('dry_run') === '1') argv.push('--force');
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const result = await run.main(argv, env, { env: {} });
    console.log = orig;
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    console.log = orig;
    return new Response(JSON.stringify({ erro: String(e && e.message || e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
});
`;
fs.mkdirSync(path.join(root, 'supabase/functions/qf-radar-coleta'), { recursive: true });
fs.writeFileSync(path.join(root, 'supabase/functions/qf-radar-coleta/index.ts'), out);
console.log('ok', out.length);
