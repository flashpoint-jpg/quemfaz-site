// V11.75: painel > "Próximos ao pedido" > botão "Lembrar quem está perto".
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase', '2026-10-11-lembrar-quem-esta-perto.sql'), 'utf8');
const aviso = fs.readFileSync(path.join(root, 'supabase', 'functions', 'quemfaz-admin-aviso', 'index.ts'), 'utf8');

// Banco: só admin dispara; o registro não é lido por ninguém de fora; trava de 10 minutos por pedido.
assert.ok(sql.includes('create table if not exists public.qf_lembretes_pedido') && sql.includes('enable row level security'));
assert.ok(sql.includes('revoke all on public.qf_lembretes_pedido from public, anon, authenticated;'));
assert.ok(sql.includes('if not private.qf_is_admin() then'));
assert.ok(sql.includes("interval '10 minutes'") && sql.includes('pg_advisory_xact_lock'));
assert.ok(sql.includes('revoke all on function public.qf_admin_lembrar_proximos(uuid) from public, anon;'));
assert.ok(sql.includes('revoke all on function private.qf_lembrete_destinatarios(uuid) from public, anon, authenticated;'));

// Quem recebe: online dentro do horário, dentro do próprio raio, sem desbloqueio, pedido ainda com vaga.
{
  const i = sql.indexOf('create or replace function private.qf_lembrete_destinatarios');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  ['pr.online is true', 'private.qf_dentro_horario(pr.horario_inicio, pr.horario_fim)', "c.status in ('aberto', 'em_negociacao')",
   '< public.qf_limite_orcamentos(c.id)', 'd.profissional_id = pr.user_id', '<= greatest(1, coalesce(pr.raio_km, 20))',
   'coalesce(pr.latitude, en.latitude)', "private.qf_pendencia_finalizacao(pr.user_id, 'profissional') is null"]
    .forEach((t) => assert.ok(f.includes(t), t));
}

// Envio: aviso comum (sem toque de chamado), abre a lista de pedidos disponíveis, e fica também dentro do app.
{
  const i = sql.indexOf('create or replace function public.qf_admin_lembrar_proximos');
  const f = sql.slice(i, sql.indexOf('$$;', i));
  assert.ok(f.includes("'action', 'user_notice'") && f.includes('quemfaz-admin-aviso') && f.includes("'tag', 'qf-lembrete-pedido'"));
  assert.ok(f.includes("v_rota constant text := '/profissional/servicos/disponiveis'"), 'quem não desbloqueou não abre /profissional/pedido/:id');
  assert.ok(f.includes('insert into public.qf_profissional_avisos') && f.includes("'lembrete_pedido'"));
  assert.ok(f.includes('v_ids[i:i + 49]'), 'a função de aviso aceita no máximo 50 por chamada');
  assert.ok(!/qf_carteiras|qf_movimentacoes|qf_chamado_cascata|update public\.qf_chamados/.test(f), 'só lembra: não mexe em carteira, cascata nem pedido');
  assert.ok(aviso.includes('.slice(0, 50)') && aviso.includes('strong: "0"'));
}

// Painel: o botão sai da tela "Próximos ao pedido" com a contagem; some sem vaga; desligado sem ninguém.
{
  const a = admin.indexOf('function admProximosHtml(d) {');
  const b = admin.indexOf("document.addEventListener('click', async function (e) {\n    const btn = e.target && e.target.closest ? e.target.closest('[data-prox-lembrar]')");
  assert.ok(a > 0 && b > a);
  const ctx = {
    PU: { escapeHtml: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') },
    icon: (n) => '<i data-icon="' + n + '"></i>', waHref: (t) => (t ? 'https://wa.me/' + t : ''),
    admCard: (t, s, c) => '<section>' + t + c + '</section>', admLinhas: (n, s, p) => n + ' ' + (n === 1 ? s : p),
    admTabela: (cab, linhas, rodape) => '<table>' + linhas.join('') + '</table>' + (rodape || ''),
    qfDiaChave: (iso) => (iso ? String(iso).slice(0, 10) : '2026-10-11'), qfDiaMes: () => '10/10', qfHora: () => '10:14',
  };
  vm.runInNewContext(admin.slice(a, b) + '\nthis.html = admProximosHtml;', ctx);
  const pro = { id: 'p1', nome: 'Zé', km: 3.2, raio_km: 30, online: true, avisado: true, lembrado: true, telefone: '11999990000' };
  const base = { id: 'c1', titulo: 'Pedreiro', bairro: 'Vila Esperança', cidade: 'São Paulo', uf: 'SP', status: 'aberto', criado_em: '2026-10-11T12:08:00Z', total: 51, profissionais: [pro] };
  const com = ctx.html({ pedidos: [Object.assign({}, base, { com_vaga: true, lembrar: 22, lembrar_com_aparelho: 7, lembrete: { em: '2026-10-11T13:14:00Z', alvo: 26, com_aparelho: 10 } })] });
  assert.ok(com.includes('data-prox-lembrar="c1"') && com.includes('Lembrar quem está perto (22)') && !/data-prox-lembrar="c1"[^>]* disabled/.test(com));
  assert.ok(com.includes('22 profissionais online, perto e sem responder · 7 com notificação no celular, os outros veem o aviso dentro do app'));
  assert.ok(com.includes('Último lembrete: hoje às 10:14, para 26 profissionais.') && com.includes('>Lembrado<'));
  const ninguem = ctx.html({ pedidos: [Object.assign({}, base, { com_vaga: true, lembrar: 0, lembrar_com_aparelho: 0 })] });
  assert.ok(/data-prox-lembrar="c1"[^>]* disabled/.test(ninguem) && ninguem.includes('Ninguém online, perto e sem responder a este pedido agora.'));
  const semVaga = ctx.html({ pedidos: [Object.assign({}, base, { status: 'em_negociacao', com_vaga: false, lembrar: 0 })] });
  assert.ok(!semVaga.includes('data-prox-lembrar'), 'pedido sem vaga não tem botão');
  assert.ok(!ctx.html({ pedidos: [base] }).includes('data-prox-lembrar'), 'servidor antigo (sem com_vaga) não quebra a tela');
}
// Clique: confirma antes, chama a função do servidor e recarrega a tela.
['PU.confirmDialog({ title: \'Lembrar \'', "rpc('qf_admin_lembrar_proximos', { p_chamado_id: btn.getAttribute('data-prox-lembrar') })", 'Lembrete enviado para ', '.qf-prox__lembrar{']
  .forEach((t) => assert.ok(admin.includes(t), t));
// App do profissional: com o app aberto, o lembrete é bipe curto + faixinha, nunca o toque de chamado.
{
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const i = index.indexOf('async function syncPersistentProfessionalNotices(session, alertNew) {');
  const f = index.slice(i, index.indexOf('\n  }\n', i));
  assert.ok(i > 0 && f.includes("if (r.tipo !== 'lembrete_pedido') soLembrete = false;"));
  assert.ok(f.includes('PU.playNotificationSound(!soLembrete)') && !f.includes('PU.playNotificationSound(true)'));
  assert.ok(index.includes(".select('id,user_id,chamado_id,tipo,titulo,corpo,rota,criado_em')"));
}
console.log('PASS lembrar quem está perto: banco, envio, painel e app');
