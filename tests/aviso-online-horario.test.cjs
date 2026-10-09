// V11.41: aviso de chamado só para quem está online e dentro do horário; admin edita tudo do profissional.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261009011500_aviso_so_online_no_horario_e_admin_edita_tudo.sql'), 'utf8');

test('banco: aviso exige online, horário e respeita o raio do profissional', () => {
  const fn = sql.slice(sql.indexOf('qf_chamado_destinatarios_alcance'), sql.indexOf('qf_admin_editar_usuario'));
  assert.match(fn, /pr\.online is true/);
  assert.match(fn, /private\.qf_dentro_horario\(pr\.horario_inicio,pr\.horario_fim\)/);
  assert.match(fn, /least\(greatest\(1,coalesce\(p_raio_km,0\)\),x\.raio_proprio\)/);
});

test('profissional: lembrete do horário na tela inicial leva direto ao ajuste', () => {
  const home = index.slice(index.indexOf('Screens.profHomeRender = function'));
  assert.match(home.slice(0, 6000), /horarioAtendimentoLembrete\(user\)/);
  const helper = index.slice(index.indexOf('function horarioAtendimentoLembrete'), index.indexOf('Screens.profHomeRender = function'));
  assert.match(helper, /data-nav="\/profissional\/configuracoes"/);
  assert.match(helper, /Ajustar horário/);
  // A tela de configurações abre com o horário no topo.
  const cfg = index.slice(index.indexOf('Screens.profConfigRender = function'));
  assert.ok(cfg.indexOf('prefChamadoSection(user)') < cfg.indexOf('Notificações'));
  assert.ok(!index.includes('Online você recebe sempre'));
});

test('admin: edita raio, cidades, horário, alerta, descrição e online', () => {
  ['eu-raio', 'eu-areas', 'eu-hini', 'eu-hfim', 'eu-alerta', 'eu-desc', 'eu-online', 'eu-fantasia'].forEach((id) => assert.ok(admin.includes("'" + id + "'") || admin.includes('id="' + id + '"'), id));
  ['raio_km', 'cidades', 'horario_inicio', 'horario_fim', 'alerta_modo', 'descricao', 'online', 'nome_fantasia'].forEach((k) => {
    assert.match(sql, new RegExp("p_dados \\? '" + k + "'"), k);
    assert.ok(admin.includes('dados.' + k), k);
  });
});
