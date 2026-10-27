const fs=require('node:fs');
const {setup}=require('./contratacao-sem-codigo.cjs'),{as}=require('./atendimento-db.cjs');
async function ready(){const x=await setup({seguranca:true});await x.d.exec(`reset role;
 alter table qf_chat_mensagens add column id uuid default gen_random_uuid(),add column lida_em timestamptz;
 alter table qf_comissao13_pix add column status text,add column txid text,add column end_to_end_id text,add column pago_em timestamptz,add column emitido_em timestamptz;
 create table qf_push_entregas(chamado_id uuid,user_id uuid,evento text,envio_status text,enviado_em timestamptz,criado_em timestamptz,envio_erro text);
 create table private.qf_pedido_historico_admin(chamado_id uuid,status_anterior text,status_novo text,criado_em timestamptz);
 `);await x.d.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_negociacoes_comissoes_admin.sql')),'utf8'));await as(x.d,11);return x;}
module.exports={ready};
