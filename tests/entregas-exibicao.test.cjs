const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
test('Exibição valida IDs pelo feed, é idempotente e não permite consulta administrativa por profissional',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function private.qf_is_admin() returns boolean language sql stable as $$select auth.uid()='00000000-0000-0000-0000-000000000099'::uuid$$;
 create table qf_profissionais(user_id uuid primary key,especialidades text[],raio_km int,horario_inicio time,horario_fim time);
 create table qf_profiles(id uuid primary key,nome text,ativo boolean,cidade text,uf text);
 create table qf_chamados(id uuid primary key,status text);
 create table qf_profissional_cidades(profissional_id uuid,cidade text,uf text,raio_km int);
 create table qf_livre_assinaturas(profissional_id uuid,inicio_em timestamptz,fim_em timestamptz);
 create table qf_planos_profissional(profissional_id uuid,plano text,valido_ate timestamptz,chamados_restantes int);
 create table qf_push_entregas(user_id uuid,chamado_id uuid,evento text,envio_status text);
 create table qf_desbloqueios(profissional_id uuid,chamado_id uuid);
 create table qf_comissao13_fechamentos(chamado_id uuid,profissional_id uuid,cliente_concluiu_em timestamptz);
 create table qf_orcamentos(profissional_id uuid,chamado_id uuid,status text);
 create function private.qf_dentro_horario(time,time) returns boolean language sql as $$select true$$;
 create function qf_portfolio_servicos() returns table(id uuid,titulo text,cidade text,bairro text,distancia_km numeric,participantes int,limite int) language sql as $$select '00000000-0000-0000-0000-000000000010'::uuid,'Gesseiro','Santo André','Bangu',25.1,0,4$$;
 create function qf_mais_oportunidades() returns table(id uuid) language sql as $$select '00000000-0000-0000-0000-000000000011'::uuid$$;
 create function qf_admin_push_diagnostico(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 insert into qf_profissionais values('00000000-0000-0000-0000-000000000001',array['cat_gesseiro'],55,'06:00','22:00');
 insert into qf_profiles values('00000000-0000-0000-0000-000000000001','Patrick',true,'Guarulhos','SP');
 insert into qf_chamados values('00000000-0000-0000-0000-000000000010','aberto'),('00000000-0000-0000-0000-000000000011','aberto'),('00000000-0000-0000-0000-000000000012','aberto');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261026144354_profissional_entregas_exibicao.sql','utf8'));
 const uid=async n=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[n?'00000000-0000-0000-0000-'+String(n).padStart(12,'0'):'']);
 const ids=[10,11,12].map(n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0'));
 await uid(1);assert.equal((await db.query('select qf_registrar_pedidos_exibidos($1) n',[ids])).rows[0].n,2);
 await db.query('select qf_registrar_pedidos_exibidos($1)',[ids]);assert.equal((await db.query('select count(*)::int n from private.qf_pedidos_exibidos')).rows[0].n,2);
 assert.equal((await db.query('select qf_admin_profissional_entregas($1) d',['00000000-0000-0000-0000-000000000001'])).rows[0].d.reason,'sem_permissao');
 await uid(null);assert.equal((await db.query('select qf_registrar_pedidos_exibidos($1) n',[ids])).rows[0].n,0);
 await uid(99);const d=(await db.query('select qf_admin_profissional_entregas($1) d',['00000000-0000-0000-0000-000000000001'])).rows[0].d;assert.equal(d.ok,true);assert.equal(d.compativeis.length,1);assert.equal(d.totais.exibidos,2);assert.equal((await db.query('select auth.uid() u')).rows[0].u,'00000000-0000-0000-0000-000000000099');
 assert.equal((await db.query("select has_function_privilege('anon','qf_registrar_pedidos_exibidos(uuid[])','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
