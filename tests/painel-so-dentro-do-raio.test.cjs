// Painel "Profissionais próximos ao pedido": só profissão certa E dentro do raio.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261017203000_painel_proximos_so_dentro_do_raio.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
assert.equal(sql.split('private.qf_pro_atende_regiao(pr.user_id, c.cidade, c.uf::text, c.latitude, c.longitude)').length - 1, 2, 'raio na contagem e na lista');
assert.ok(!sql.includes('cardinality(pr.especialidades) = 0'), 'sem profissão não entra');
assert.ok(sql.includes('c.categoria = any(coalesce(pr.especialidades'));
assert.ok(sql.includes('(o.sem and private.qf_pro_de_outros(pr.especialidades))'));
assert.ok(html.includes("'Nenhum profissional desse serviço dentro do raio deste pedido.'"));
console.log('painel-so-dentro-do-raio ok');
