// V11.73: propaganda com um plano só (QuemFaz Premium), solicitada sem cadastro, conferida pelo admin.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'index.html'),'utf8');
const adm=fs.readFileSync(path.join(root,'admin.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'supabase/2026-10-11-quemfaz-premium-propaganda.sql'),'utf8');
const fn=fs.readFileSync(path.join(root,'supabase/functions/quemfaz-anuncio-premium/index.ts'),'utf8');
const tela=src.slice(src.indexOf('  Screens.anuncieRender = function'),src.indexOf('  // ---------------- Categoria ----------------'));
// Um plano só: nada de Local/Destaque à venda, nem na tela nem no painel.
assert.ok(tela.includes('QuemFaz Premium')&&!/planCard\(|name="plano"|Destaque/.test(tela));
assert.ok(!src.includes("adRow('local'")&&!src.includes("adRow('destaque'")&&!src.includes('a partir de R$ 79'));
assert.ok(adm.includes("priceInput('premium')")&&!adm.includes("priceInput('local')"));
assert.ok(/if p_plano <> 'premium' then\s+return jsonb_build_object\('ok', false, 'reason', 'sem_incluso'\)/.test(sql));
assert.ok(sql.includes("jsonb_build_object('premium_centavos', 30000)"));
// Formulário: o que aparece, foto ou logotipo obrigatório, destino do clique (WhatsApp, ligação ou site) e contato de quem pede.
for(const t of ['name="empresa"','name="chamada"','id="qf-prem-img"','data-prem-dest="whatsapp"','data-prem-dest="ligacao"','data-prem-dest="site"','name="nome"','name="whatsapp"','Sem cadastro'])assert.ok(tela.includes(t),t);
assert.ok(src.includes("PU.toast('Envie a foto ou o logotipo da empresa.', 'danger')"));
// Sem conta: o envio vai pela função do servidor, que gera o Pix; nada de pedir login.
const bind=src.slice(src.indexOf('  function bindAnuncie(content) {'),src.indexOf('  Screens.bindAnunciePublic = bindAnuncie;'));
assert.ok(bind.includes('global.QFCloud.requestPremiumAd(')&&!bind.includes('Entre para continuar'));
assert.ok(src.includes("client.functions.invoke('quemfaz-anuncio-premium'"));
assert.ok(fn.includes('"qf_anuncio_premium_criar"')&&fn.includes('provedor: "efi"')&&fn.includes('imagem.length > 700000'));
// Quem pediu fica fora do alcance do público; as funções do servidor não são abertas a anon.
assert.ok(sql.includes('alter table public.qf_anuncio_solicitacoes enable row level security'));
assert.ok(sql.includes('revoke all on public.qf_anuncio_solicitacoes from public, anon, authenticated'));
assert.ok(/revoke execute on function public\.qf_anuncio_premium_criar\([^)]*\) from public, anon, authenticated/.test(sql));
// O admin confere e corrige antes de publicar; só aprova depois do Pix.
assert.ok(adm.includes('data-ad-action="corrigir"')&&adm.includes("client.rpc('qf_admin_editar_anuncio'")&&adm.includes("client.rpc('qf_admin_anuncio_solicitantes')"));
assert.ok(adm.includes("a.status === 'aguardando_aprovacao' && a.pagamentoStatus === 'aprovado' ? '<button class=\"btn btn--sm btn--primary btn--block-auto\" data-ad-action=\"aprovar\""));
assert.ok(sql.includes('if not private.qf_is_admin() then raise exception'));
// A propaganda aprovada entra na faixa da tela inicial; o clique abre o destino da empresa e é contado.
assert.ok(src.includes("global.QFCloud.homePremiumAds().then(")&&src.includes("global.QFCloud.adEvent(s.ad,'clique')")&&src.includes("global.QFCloud.adEvent(s.ad,'visualizacao')"));
assert.ok(src.includes(".eq('plano', 'premium').eq('status', 'aprovado').eq('pagamento_status', 'aprovado')"));
// A imagem que vem do banco só entra na tela se for mesmo uma imagem.
assert.ok(src.includes("/^data:image\\/(jpeg|png|webp);base64,[A-Za-z0-9+\\/=]+$/.test(String(a.imagem_data||''))"));
console.log('quemfaz-premium: plano único, formulário sem cadastro, Pix pelo servidor, correção do admin e faixa da home: ok');
