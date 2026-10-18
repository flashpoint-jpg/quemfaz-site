const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ADMIN=uid(900), PRO=uid(1), PRO2=uid(2), PRO3=uid(3), OUTRO=uid(50);

/* ---------- Banco (PGlite) ---------- */
let PGlite=null;
try{({PGlite}=require('@electric-sql/pglite'));}catch(_){}
const schema=`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.qf_profissionais(user_id uuid primary key, criado_em timestamptz default now());
create table public.qf_profiles(id uuid primary key, nome text, nome_fantasia text, cidade text, uf text);
create table public.qf_admins(user_id uuid primary key, criado_em timestamptz default now());
create table public.qf_push_subscriptions(id uuid default gen_random_uuid(), user_id uuid, endpoint text, ativo boolean);
grant usage on schema public to anon, authenticated, service_role;
grant select on public.qf_profissionais, public.qf_profiles, public.qf_admins, public.qf_push_subscriptions to authenticated;
`;
async function database(){
  const db=new PGlite();
  await db.exec(schema);
  await db.exec(fs.readFileSync('supabase/migrations/20261018003000_profissional_acessos.sql','utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261018005000_profissional_acessos_desempate.sql','utf8'));
  for(const [id,nome,cid] of [[PRO,'Ana','Muzambinho'],[PRO2,'Bruno','Alfenas'],[PRO3,'Carla','Guaxupé']]){
    await db.query('insert into public.qf_profissionais(user_id) values($1)',[id]);
    await db.query("insert into public.qf_profiles values($1,$2,null,$3,'MG')",[id,nome,cid]);
  }
  await db.query('insert into public.qf_admins(user_id) values($1)',[ADMIN]);
  return db;
}
const as=async(db,id)=>{await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role authenticated');};
const reg=(db,t,c,e,v,p,a)=>db.query('select public.qf_registrar_acesso_profissional($1,$2,$3,$4,$5,$6) r',[t,c,e,v,p,a]);

test('banco: profissional registra o próprio acesso e repetição recente não duplica',{skip:!PGlite&&'PGlite indisponível neste ambiente (roda no CI)'},async()=>{
  const db=await database(); await as(db,PRO);
  let r=(await reg(db,'navegador','inferida','display_mode_browser',null,'default',false)).rows[0].r;
  assert.equal(r.registrado,true);
  r=(await reg(db,'navegador','inferida','display_mode_browser',null,'default',false)).rows[0].r;
  assert.deepEqual([r.registrado,r.motivo],[false,'recente']);
  r=(await reg(db,'navegador','inferida','display_mode_browser',null,'granted',true)).rows[0].r;
  assert.equal(r.registrado,true,'mudança de notificações gera novo registro');
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from public.qf_profissional_acessos')).rows[0].n,2);
});

test('banco: quem não é profissional e visitante não gravam; tipo inválido vira desconhecido',{skip:!PGlite&&'PGlite indisponível neste ambiente (roda no CI)'},async()=>{
  const db=await database(); await as(db,OUTRO);
  assert.equal((await reg(db,'pwa','inferida',null,null,null,null)).rows[0].r.motivo,'nao_profissional');
  await as(db,'');
  await assert.rejects(()=>reg(db,'pwa','inferida',null,null,null,null),/forbidden/);
  await as(db,PRO);
  await reg(db,'qualquer_coisa','confirmada',null,null,'xyz',null);
  await db.exec('reset role');
  const row=(await db.query('select tipo_acesso,confianca,push_permissao from public.qf_profissional_acessos')).rows[0];
  assert.deepEqual(row,{tipo_acesso:'desconhecido',confianca:'confirmada',push_permissao:null});
});

test('banco: cliente autenticado não insere direto nem lê dados de outro profissional; anônimo não acessa',{skip:!PGlite&&'PGlite indisponível neste ambiente (roda no CI)'},async()=>{
  const db=await database(); await as(db,PRO); await reg(db,'pwa','inferida',null,null,null,null);
  await db.exec('reset role'); await as(db,PRO2);
  await assert.rejects(()=>db.query("insert into public.qf_profissional_acessos(profissional_id,tipo_acesso) values($1,'pwa')",[PRO2]),/permission denied/);
  assert.equal((await db.query('select count(*)::int n from public.qf_profissional_acessos')).rows[0].n,0);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(()=>db.query('select * from public.qf_profissional_acessos'),/permission denied/);
  await assert.rejects(()=>db.query('select public.qf_admin_monitoramento_profissionais()'),/permission denied/);
});

test('banco: painel consolidado só para administrador e sem inventar dados',{skip:!PGlite&&'PGlite indisponível neste ambiente (roda no CI)'},async()=>{
  const db=await database();
  await db.query("insert into public.qf_profissional_acessos(profissional_id,tipo_acesso,confianca,push_permissao,push_ativo,acessado_em) values($1,'play_store','confirmada','granted',true,now()-interval '2 hours'),($1,'play_store','confirmada','granted',true,now()-interval '3 days'),($2,'navegador','inferida','denied',false,now()-interval '20 days')",[PRO,PRO2]);
  await db.query("insert into public.qf_push_subscriptions(user_id,endpoint,ativo) values($1,'fcm:abc',true),($2,'https://fcm.googleapis.com/x',true)",[PRO,PRO3]);
  await as(db,PRO);
  await assert.rejects(()=>db.query('select public.qf_admin_monitoramento_profissionais()'),/forbidden/);
  await db.exec('reset role'); await as(db,ADMIN);
  const d=(await db.query('select public.qf_admin_monitoramento_profissionais() r')).rows[0].r;
  assert.equal(d.linhas.length,3);
  const por=Object.fromEntries(d.linhas.map(l=>[l.nome,l]));
  assert.deepEqual([por.Ana.tipo_acesso,por.Ana.confianca,por.Ana.dias_ativos_7d,por.Ana.dias_ativos_30d,por.Ana.notificacoes],['play_store','confirmada',2,2,'ativas']);
  assert.deepEqual([por.Bruno.tipo_acesso,por.Bruno.ativo_7d,por.Bruno.ativo_30d,por.Bruno.notificacoes],['navegador',false,true,'bloqueadas']);
  assert.equal(por.Carla.tipo_acesso,null,'sem registro não vira tipo confirmado');
  assert.equal(por.Carla.tipo_estimado,'web_pwa_ou_navegador');
  assert.equal(por.Carla.ultimo_acesso,null);
});

/* ---------- Detecção e registro no navegador/app ---------- */
function carregarModulo(opts){
  opts=opts||{};
  const chamadas=[], store=Object.assign({},opts.storage||{});
  const win={
    Capacitor:opts.native?{isNativePlatform:()=>true}:undefined,
    matchMedia:q=>({matches:!!(opts.standalone&&/standalone/.test(q))}),
    navigator:{standalone:false},
    DB:{getSession:()=>opts.session===undefined?{role:'profissional',userId:PRO}:opts.session},
    QFPush:{permission:()=>opts.perm||'default',isActive:()=>!!opts.pushOn},
    QFCloud:{client:{rpc:async(n,a)=>{chamadas.push([n,a]);return opts.rpcResult||{data:{registrado:true},error:null};},auth:{onAuthStateChange(){}}}},
    addEventListener(){}, setTimeout:()=>0
  };
  win.window=win; win.globalThis=win;
  const ctx=vm.createContext(Object.assign(win,{
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
    document:{readyState:'loading',addEventListener(){},visibilityState:'visible'},
    console, Date, JSON, setTimeout:()=>0
  }));
  vm.runInContext(fs.readFileSync('qf-acesso-profissional.js','utf8'),ctx);
  return {api:win.QFAcessoProfissional,chamadas,store};
}

test('detecção: app nativo é confirmado; TWA, PWA e navegador são estimativas',()=>{
  assert.deepEqual({...carregarModulo({native:true}).api.detectarTipoAcesso()},{tipo_acesso:'play_store',confianca:'confirmada',evidencia:'capacitor_nativo',app_versao:null});
  const twa=carregarModulo({standalone:true,storage:{qf_platform:'android'}}).api.detectarTipoAcesso();
  assert.deepEqual([twa.tipo_acesso,twa.confianca],['play_store','inferida']);
  const pwa=carregarModulo({standalone:true}).api.detectarTipoAcesso();
  assert.deepEqual([pwa.tipo_acesso,pwa.confianca],['pwa','inferida']);
  const nav=carregarModulo({}).api.detectarTipoAcesso();
  assert.deepEqual([nav.tipo_acesso,nav.confianca],['navegador','inferida']);
});

test('detecção: marca antiga de Android no navegador comum não vira app',()=>{
  const m=carregarModulo({standalone:false,storage:{qf_platform:'android'}}).api.detectarTipoAcesso();
  assert.equal(m.tipo_acesso,'navegador');
});

test('registro: só profissional autenticado, uma vez por intervalo, com dados reais de notificação',async()=>{
  const sem=carregarModulo({session:null}); 
  assert.equal((await sem.api.registrar()).motivo,'sem_sessao_profissional'); assert.equal(sem.chamadas.length,0);
  const cli=carregarModulo({session:{role:'cliente',userId:OUTRO}});
  assert.equal((await cli.api.registrar()).registrado,false); assert.equal(cli.chamadas.length,0);
  const m=carregarModulo({standalone:true,perm:'granted',pushOn:true});
  assert.equal((await m.api.registrar()).registrado,true);
  const [nome,args]=m.chamadas[0];
  assert.equal(nome,'qf_registrar_acesso_profissional');
  assert.deepEqual({...args},{p_tipo:'pwa',p_confianca:'inferida',p_evidencia:'display_mode_standalone',p_app_versao:null,p_push_permissao:'granted',p_push_ativo:true});
  assert.equal((await m.api.registrar()).motivo,'recente'); assert.equal(m.chamadas.length,1);
});

test('registro: erro do servidor não quebra o app nem marca como registrado',async()=>{
  const m=carregarModulo({rpcResult:{data:null,error:{message:'falhou'}}});
  assert.equal((await m.api.registrar()).registrado,false);
  assert.equal(m.store.qf_acesso_prof_ultimo,undefined);
});

/* ---------- Painel administrativo ---------- */
const painel=require('../qf-admin-monitoramento.js');
const L=[
  {nome:'A',tipo_acesso:'play_store',confianca:'confirmada',ativo_7d:true,ativo_30d:true,notificacoes:'ativas',ultimo_acesso:'2026-10-18T01:00:00Z'},
  {nome:'B',tipo_acesso:'pwa',confianca:'inferida',ativo_7d:false,ativo_30d:true,notificacoes:'bloqueadas',ultimo_acesso:'2026-10-01T01:00:00Z'},
  {nome:'C',tipo_acesso:'navegador',confianca:'inferida',ativo_7d:false,ativo_30d:false,notificacoes:'inativas',ultimo_acesso:'2026-08-01T01:00:00Z'},
  {nome:'D',tipo_acesso:null,tipo_estimado:'app_android',ativo_7d:false,ativo_30d:false,notificacoes:'ativas',ultimo_acesso:null},
  {nome:'E',tipo_acesso:null,tipo_estimado:null,ativo_7d:false,ativo_30d:false,notificacoes:'inativas',ultimo_acesso:null},
];
test('painel: indicadores e filtros por tipo, atividade e notificações',()=>{
  const r=painel.resumir(L);
  assert.deepEqual([r.total,r.com_registro,r.android,r.pwa,r.navegador,r.nao_identificado],[5,3,2,1,1,1]);
  assert.deepEqual([r.ativos_7d,r.ativos_30d,r.notif_ativas,r.notif_bloqueadas,r.notif_inativas],[1,2,2,1,2]);
  assert.deepEqual(painel.filtrar(L,{tipo:'android'}).map(x=>x.nome),['A','D']);
  assert.deepEqual(painel.filtrar(L,{atividade:'30d'}).map(x=>x.nome),['A','B']);
  assert.deepEqual(painel.filtrar(L,{atividade:'inativos'}).map(x=>x.nome),['C','D','E']);
  assert.deepEqual(painel.filtrar(L,{notificacoes:'bloqueadas'}).map(x=>x.nome),['B']);
  assert.deepEqual(painel.filtrar(L,{tipo:'android',atividade:'7d',notificacoes:'ativas'}).map(x=>x.nome),['A']);
});

test('painel: estimativa nunca aparece como confirmada',()=>{
  assert.match(painel.rotuloTipo(L[0]),/confirmado/);
  assert.match(painel.rotuloTipo(L[1]),/estimado/);
  assert.match(painel.rotuloTipo(L[3]),/estimado/);
  assert.doesNotMatch(painel.rotuloTipo(L[3]),/confirmado/);
  assert.match(painel.rotuloTipo(L[4]),/Não identificado/);
});

/* ---------- Integração e restrições ---------- */
test('integração: scripts publicados e nenhuma regra financeira alterada',()=>{
  const admin=fs.readFileSync('admin.html','utf8');
  assert.match(admin,/<script src="qf-admin-monitoramento\.js\?v=1"><\/script>/);
  assert.match(fs.readFileSync('scripts/build-client.cjs','utf8'),/qf-acesso-profissional\.js/);
  const sql=fs.readFileSync('supabase/migrations/20261018003000_profissional_acessos.sql','utf8');
  assert.doesNotMatch(sql,/\b(alter|drop|delete from|update|truncate)\s+(table\s+)?public\.qf_(carteiras|recargas|movimentacoes|desbloqueios|chamados|bonus|planos|profissionais|profiles)/i);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/qf_admins/);
});
