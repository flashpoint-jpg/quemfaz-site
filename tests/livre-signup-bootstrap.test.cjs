const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync('supabase/migrations/20261029032400_signup_livre_bootstrap.sql','utf8');
const uid=n=>'00000000-0000-4000-a000-'+String(n).padStart(12,'0');

test('Cadastro no trigger de auth funciona antes de pagar, sem conceder acesso',async()=>{
 const db=new PGlite();
 try{
  await db.exec([
   'CREATE SCHEMA auth',
   'CREATE SCHEMA private',
   'CREATE TABLE auth.users(id uuid PRIMARY KEY)',
   'CREATE TABLE public.qf_profiles(id uuid PRIMARY KEY,tipo text NOT NULL)',
   'CREATE TABLE public.qf_profissionais(user_id uuid PRIMARY KEY)',
   'CREATE FUNCTION private.qf_cadastro_profissional_pago(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT false$$'
  ].join(';')+';');
  await db.exec(sql);
  await db.exec([
   'CREATE TRIGGER bloquear_perfil BEFORE INSERT OR UPDATE OF tipo ON public.qf_profiles FOR EACH ROW EXECUTE FUNCTION private.qf_exigir_pagamento_perfil_profissional()',
   'CREATE TRIGGER bloquear_prof BEFORE INSERT ON public.qf_profissionais FOR EACH ROW EXECUTE FUNCTION private.qf_exigir_pagamento_profissional()',
   "CREATE FUNCTION public.criar_perfil_auth() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN INSERT INTO public.qf_profiles(id,tipo) VALUES(NEW.id,'profissional'); INSERT INTO public.qf_profissionais(user_id) VALUES(NEW.id); RETURN NEW; END$$",
   'CREATE TRIGGER bootstrap AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.criar_perfil_auth()'
  ].join(';')+';');
  await db.query('INSERT INTO auth.users(id) VALUES($1)',[uid(1)]);
  assert.equal((await db.query('SELECT count(*)::integer n FROM qf_profissionais')).rows[0].n,1);
  assert.equal((await db.query('SELECT private.qf_cadastro_profissional_pago($1) ok',[uid(1)])).rows[0].ok,false);
  await assert.rejects(()=>db.query("INSERT INTO qf_profiles(id,tipo) VALUES($1,'profissional')",[uid(2)]),/Pagamento inicial/);
  await db.query("INSERT INTO qf_profiles(id,tipo) VALUES($1,'cliente')",[uid(3)]);
  await assert.rejects(()=>db.query("UPDATE qf_profiles SET tipo='profissional' WHERE id=$1",[uid(3)]),/Pagamento inicial/);
  await assert.rejects(()=>db.query('INSERT INTO qf_profissionais(user_id) VALUES($1)',[uid(4)]),/Pagamento inicial/);
 }finally{await db.close();}
});

test('Cartao destaca beneficio de 2 dias e nao exibe cortesia livremente',()=>{
 const src=fs.readFileSync('qf-livre.js','utf8');
 assert.match(src,/desbloqueios ilimitados por 2 dias/i);
 assert.match(src,/Sem Pix, recarga ou pagamento inicial/);
 assert.match(src,/courtesyInput.checked=false/);
 assert.match(src,/courtesyRow.remove/);
 assert.match(src,/cobrança automática/i);
 assert.match(src,/qf-trial-card--selected/);
 assert.doesNotThrow(()=>new (require('node:vm').Script)(src));
});
