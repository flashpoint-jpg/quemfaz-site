const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture,rpc,answers}=require('./comissao13-owner.cjs');
const {as}=require('./atendimento-db.cjs');
const migration=fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_confirmacao_contratacao_sem_codigo.sql'));
async function setup(options={}){
 const d=await fixture();await d.exec('reset role');
 await d.exec(`alter table qf_comissao13_fechamentos add column proposta_chat_em timestamptz;
 alter table qf_chat_mensagens add column mensagem text;
 create function private.qf_livre_identificacao(uuid) returns boolean language sql as $$select true$$;
 create table qf_comissao13_pix(id uuid default gen_random_uuid(),fechamento_id uuid unique,profissional_id uuid,valor_centavos bigint);
 create function private.qf_comissao13_automatico() returns trigger language plpgsql as $$begin return null;end$$;
 create trigger qf_comissao13_auto_pix after insert or update of status,cliente_resposta,codigo_validado_em,cobranca_status on qf_comissao13_fechamentos for each row execute function private.qf_comissao13_automatico();`);
 await d.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 if(options.melhorias||options.seguranca)await d.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_melhorias_confirmacao_comissao.sql')),'utf8'));
 if(options.seguranca)await d.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_livre_confirmacao_segura_sem_admin.sql')),'utf8'));
 await as(d,1);const a=answers(),call=await rpc(d,'qf_publicar_atendimento',[a,{latitude:-23.66,longitude:-46.53}]);
 await as(d,11);assert.equal((await rpc(d,'qf_comissao13_desbloquear',[call.id,true])).ok,true);
 const f=(await rpc(d,'qf_comissao13_fechamentos_painel'))[0];
 return {d,a,call,f};
}
module.exports={setup};
