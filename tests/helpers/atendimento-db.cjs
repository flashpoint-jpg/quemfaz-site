const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration=fs.readFileSync('supabase/migrations/20261022013032_atendimento_obrigatorio.sql','utf8');
const answers=(changes={})=>({versao:1,chave:uid(200),categoria:'pintor',servico:'Pintor',detalhes:'Pintar paredes internas',escopo:'50 metros quadrados',cidade:'Santo André',uf:'SP',bairro:'Centro',urgencia:'urgente',orcamento_centavos:30000,materiais:'profissional',data:'2099-10-22',disponibilidade:'Entre 8h e 12h',nome:'Cliente Teste',contato:'11988887777',intencao:'contratar',autorizacao:'sim',tipo:'tradicional',qualificacao:null,...changes});
async function db(d=new PGlite()){
 await d.exec(fs.readFileSync('tests/fixtures/valor-definido-schema.sql','utf8'));
 await d.exec(`alter table public.qf_chamados add column cep text,add column geo_precisao text,add column data_preferida timestamptz,add column marketing_origem jsonb;
 alter table public.qf_profissionais add column verificado boolean default false,add column documento text;
 alter table public.qf_chamados enable row level security;
 create policy owner on public.qf_chamados for all to authenticated using(cliente_id=auth.uid()) with check(cliente_id=auth.uid());
 grant select,insert,update on public.qf_chamados to authenticated;
 insert into public.qf_profiles(id,tipo,nome,telefone,whatsapp) values('${uid(1)}','cliente','Cliente Teste','11988887777','11988887777');
 insert into public.qf_precos_desbloqueio values('pintor',1000,true);
 insert into public.qf_config values('desbloqueio_exclusivo','{"ativo":true,"multiplicador":4}',now());
 insert into public.qf_chamados(id,cliente_id,categoria,descricao,cidade,uf,bairro,latitude,longitude,max_orcamentos) values('${uid(100)}','${uid(1)}','pintor','Pedido legado','Santo André','SP','Centro',-23.66,-46.53,4);
 `);
 await d.exec(fs.readFileSync('supabase/2026-10-19-interesse-do-cliente.sql','utf8'));
 await d.exec('alter table public.qf_chamados add column orcamento_aproximado_centavos integer;');
 await d.exec("create table public.qf_cidades_coord(chave text,uf text,cidade text,latitude numeric,longitude numeric);create or replace function private.qf_norm_txt(text) returns text language sql immutable as $$select lower(trim($1))$$;");
 await d.exec(fs.readFileSync('tests/fixtures/atendimento-production-functions.sql','utf8'));
 await d.exec(migration);
 // Existing notification integration is represented by a transactional outbox fixture, not a real push.
 await d.exec(`create function private.test_new_call() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into private.test_dispatch values('new_call',new.id);return new;end $$;
 create trigger test_new after insert on public.qf_chamados for each row execute function private.test_new_call();`);
 for(let i=11;i<=16;i++)await d.exec(`insert into public.qf_profiles(id,tipo,nome,foto_url) values('${uid(i)}','profissional','Pro ${i}','selfie');
 insert into public.qf_profissionais(user_id,especialidades,latitude,longitude,verificado,documento) values('${uid(i)}',array['pintor'],-23.66,-46.53,${i!==16},'documento-validado');
 insert into public.qf_carteiras values('${uid(i)}',100000,0,true,now());`);
 await as(d,1);return d;
}
async function as(d,n){await d.exec('reset role');await d.query("select set_config('request.jwt.claim.sub',$1,false)",[n?uid(n):'']);await d.exec(n?'set role authenticated':'set role anon');}
async function pub(d,a=answers()){return (await d.query('select public.qf_publicar_atendimento($1::jsonb,$2::jsonb) r',[JSON.stringify(a),JSON.stringify({latitude:-23.66,longitude:-46.53})])).rows[0].r;}
async function unlock(d,id,exclusive=false){return (await d.query('select public.qf_desbloquear_chamado($1,$2) r',[id,exclusive])).rows[0].r;}
async function scalar(d,sql){return Object.values((await d.query(sql)).rows[0])[0];}
module.exports={uid,answers,db,as,pub,unlock,scalar};
