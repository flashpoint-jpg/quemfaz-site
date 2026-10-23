const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {PGlite} = require('@electric-sql/pglite');
const migration = fs.readFileSync('supabase/migrations/20261023215706_identificacao_quemfaz_livre.sql','utf8');
test('Selo Livre exige pagamento aprovado e vigência, inclusive início e expiração', async () => {
 const db = new PGlite();
 try {
 await db.exec(`create schema private; create table qf_recargas(id uuid,status text); create table qf_livre_assinaturas(profissional_id uuid,recarga_id uuid,inicio_em timestamptz,fim_em timestamptz);`);
 await db.exec(migration.match(/create or replace function private.qf_livre_identificacao[\s\S]*?\$\$;/)[0]);
 for (const [i,status,start,end,expected] of [[1,'aprovado','-1 day','1 day',true],[2,'pendente','-1 day','1 day',false],[3,'aprovado','-2 day','-1 day',false],[4,'aprovado','1 day','31 day',false],[5,'cancelado','-1 day','1 day',false]]) {
 const id = `00000000-0000-0000-0000-${String(i).padStart(12,'0')}`;
 await db.query(`insert into qf_recargas values ($1,$2)`,[id,status]);
 await db.query(`insert into qf_livre_assinaturas values ($1,$1,now()+$2::interval,now()+$3::interval)`,[id,start,end]);
 const result=await db.query('select private.qf_livre_identificacao($1) ativo',[id]);
 assert.equal(result.rows[0].ativo,expected);
 }
 } finally {await db.close();}
});
test('Painel destaca Livre pago mesmo com zero saldo e plano antigo; expirado não recebe selo ativo',()=>{
 const html=fs.readFileSync('admin.html','utf8');
 const helpers=html.slice(html.indexOf('  function adminPlanoDoProf('),html.indexOf('  // Indicação:'));
 const ctx={DB:{state:{planosProf:[]}},PU:{escapeHtml:String}}; vm.createContext(ctx);vm.runInContext(helpers,ctx);
 const now=Date.now(), row={profissional_id:'p',plano:'livre',inicio_em:new Date(now-10000).toISOString(),valido_ate:new Date(now+86400000).toISOString(),chamados_restantes:null};
 ctx.DB.state.planosProf=[{...row,plano:'mensal',chamados_restantes:2},row];
 assert.match(ctx.adminPlanoHtml('p'),/Quem Faz Livre · Ativo/);assert.match(ctx.adminPlanoHtml('p'),/Desbloqueios ilimitados/);
 ctx.DB.state.planosProf=[{...row,valido_ate:new Date(now-1000).toISOString()}];assert.match(ctx.adminPlanoHtml('p'),/Expirado/);assert.doesNotMatch(ctx.adminPlanoHtml('p'),/· Ativo/);
 ctx.DB.state.planosProf=[{...row,inicio_em:new Date(now+1000).toISOString()}];assert.match(ctx.adminPlanoHtml('p'),/Agendado/);
 ctx.DB.state.planosProf=[];assert.equal(ctx.adminPlanoHtml('p'),'');
});
test('Cliente vê selo Livre somente nos profissionais com assinatura ativa',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const source=html.slice(html.indexOf('  function renderConversationCards('),html.indexOf('  function orcMax(req)',html.indexOf('  function renderConversationCards(')));
 const ctx={global:{QFUI:{personAvatar:()=>''}},esc:s=>String(s).replaceAll('<','&lt;'),icon:()=>'',orcMax:()=>4,clienteVagasHtml:()=>''};vm.createContext(ctx);vm.runInContext(source,ctx);
 const row={profissional_id:'p',profissional_nome:'Patrick <script>',selecionado:true};
 const active=ctx.renderConversationCards([{...row,plano_livre_ativo:true}],{id:'pedido'});
 assert.match(active,/Quem Faz Livre/);assert.match(active,/Patrick &lt;script>/);assert.doesNotMatch(active,/Patrick <script>/);
 assert.doesNotMatch(ctx.renderConversationCards([{...row,plano_livre_ativo:false}],{id:'pedido'}),/Quem Faz Livre/);
});
