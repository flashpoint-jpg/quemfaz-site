// Real cross-connection races. Refuses every target except the disposable local CI database.
const assert=require('node:assert/strict');
const {Client}=require('pg');
const {db,as,pub,answers,uid,scalar}=require('./helpers/atendimento-db.cjs');
const target=process.env.QF_TEST_DATABASE_URL;
if(!target)throw Error('QF_TEST_DATABASE_URL must identify the disposable local qf_atendimento_test database');
const u=new URL(target);
if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/qf_atendimento_test')throw Error('Refusing non-test database');
function adapter(client){return {exec:s=>client.query(s),query:(s,a)=>client.query(s,a),close:()=>client.end()};}
(async()=>{
 const admin=new Client({connectionString:target});await admin.connect();
 const c=adapter(admin);const connections=[];
 try{
  assert.equal(await scalar(c,'select current_database()'),'qf_atendimento_test');
  await db(c);await c.exec('reset role');
  for(let i=0;i<6;i++){const p=new Client({connectionString:target});await p.connect();connections.push(p);}
  async function queryAs(p,n,sql,args){await p.query('begin');try{await p.query("select set_config('request.jwt.claim.sub',$1,true)",[uid(n)]);await p.query('set local role authenticated');const out=await p.query(sql,args);await p.query('commit');return out.rows[0].r;}catch(e){await p.query('rollback');throw e;}}
  const rows=await Promise.all(connections.map(p=>queryAs(p,1,'select public.qf_publicar_atendimento($1::jsonb,$2::jsonb) r',[JSON.stringify(answers()),JSON.stringify({latitude:-23.66,longitude:-46.53})])));
  assert.equal(new Set(rows.map(r=>r.id)).size,1);
  assert.equal(Number(await scalar(c,"select count(*) from private.test_dispatch where evento='new_call'")),1);
  const normal=rows[0].id;
  const unlocks=await Promise.all(connections.map((p,i)=>queryAs(p,11+i,'select public.qf_desbloquear_chamado($1,false) r',[normal])));
  assert.equal(unlocks.filter(r=>r.ok).length,4);
  assert.equal(Number(await scalar(c,`select count(*) from public.qf_desbloqueios where chamado_id='${normal}'`)),4);
  await as(c,1);const g=await pub(c,answers({chave:uid(201),tipo:'garante',qualificacao:'sim',detalhes:'Pintar segunda sala comercial'}));await c.exec('reset role');
  const races=await Promise.all(connections.slice(0,5).map((p,i)=>queryAs(p,11+i,'select public.qf_desbloquear_chamado($1,true) r',[g.id])));
  assert.equal(races.filter(r=>r.ok).length,1);
  assert.equal(Number(await scalar(c,`select count(*) from public.qf_movimentacoes_carteira where referencia_id='${g.id}'`)),1);
  assert.equal(await scalar(c,`select sum(valor_centavos) from public.qf_movimentacoes_carteira where referencia_id='${g.id}'`),'4000');
  assert.equal(await scalar(c,'select sum(saldo_centavos) from public.qf_carteiras'),'592000');
  console.log('PASS Postgres: 6 simultaneous publications → 1 order/notification; 6 traditional unlocks → 4 debits; 5 exclusive unlocks → 1 debit of 4×; ledger balances match');
 }finally{await Promise.all(connections.map(c=>c.end()));await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
