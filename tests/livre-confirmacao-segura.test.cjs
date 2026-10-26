const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/contratacao-sem-codigo.cjs'),{rpc}=require('./helpers/comissao13-owner.cjs'),{as,uid}=require('./helpers/atendimento-db.cjs');
async function ready(){return setup({melhorias:true,seguranca:true});}
test('Cliente confirma valor, código e conclusão; Pix único sem ADM, vencimento de 48h e liberação só pelo pagamento',async()=>{
 const {d,a,call,f}=await ready();try{
  await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'propor',35000]);
  const pro=await rpc(d,'qf_chat_contratacao',[call.id,uid(11)]);assert.equal(pro.codigo_seguranca,null);
  await as(d,1);const owner=await rpc(d,'qf_chat_contratacao',[call.id,uid(11)]);assert.match(owner.codigo_seguranca,/^\d{6}$/);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000])).reason,'conclusao_obrigatoria');
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000,null,true])).reason,'codigo_obrigatorio');
  const wrong=owner.codigo_seguranca==='000000'?'111111':'000000';assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000,wrong,true])).reason,'codigo_invalido');
  await d.exec('reset role');assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,0);
  await as(d,12);assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000,owner.codigo_seguranca,true])).ok,false);
  await as(d,0);assert.equal((await rpc(d,'qf13_acompanhar',[call.id,'b'.repeat(64),'responder',f.id,true,35000,owner.codigo_seguranca,true])).ok,false);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true,35000,owner.codigo_seguranca,true])).ok,true);
  assert.equal((await rpc(d,'qf13_acompanhar',[call.id,a.segredo_acompanhamento,'responder',f.id,true,35000,owner.codigo_seguranca,true])).ok,true);
  await d.exec('reset role');const row=(await d.query('select * from qf_comissao13_fechamentos where id=$1',[f.id])).rows[0];assert.equal(Number(row.comissao_centavos),4550);assert.ok(row.codigo_validado_em);assert.ok(row.cliente_concluiu_em);assert.equal(row.confirmado_por,null);assert.equal(new Date(row.comissao_vence_em)-new Date(row.confirmado_em),48*3600000);
  assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,1);
  assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,null);
  await d.query("update qf_comissao13_fechamentos set comissao_vence_em=now()-interval '1 minute' where id=$1",[f.id]);assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,'comissao_pendente');
  await d.query("update qf_comissao13_fechamentos set cobranca_status='paga' where id=$1",[f.id]);assert.equal((await d.query('select private.qf13_bloqueio($1) b',[uid(11)])).rows[0].b,null);
 }finally{await d.close();}
});
test('Limite de tentativas e valor desatualizado não geram cobrança; ADM só resolve divergências',async()=>{
 const {d,call,f}=await ready();try{
  await rpc(d,'qf_comissao13_prestar_contas',[f.id,'informado',35000]);await as(d,1);const owner=await rpc(d,'qf_chat_contratacao',[call.id,uid(11)]);
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',40000,owner.codigo_seguranca,true])).reason,'valor_alterado');
  const wrong=owner.codigo_seguranca==='000000'?'111111':'000000';for(let i=0;i<5;i++)assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000,wrong,true])).reason,'codigo_invalido');
  assert.equal((await rpc(d,'qf_chat_contratacao',[call.id,uid(11),'aceitar',35000,owner.codigo_seguranca,true])).reason,'limite_codigo');
  await d.exec("reset role;select set_config('test.admin','true',false)");await as(d,1);assert.equal((await rpc(d,'qf_comissao13_admin',[f.id,'confirmar',35000,'Conferência administrativa indevida no fluxo normal'])).reason,'admin_apenas_divergencias');
  await d.exec('reset role');assert.equal((await d.query('select count(*)::int n from qf_comissao13_pix')).rows[0].n,0);
 }finally{await d.close();}
});
test('PWA exibe o badge transparente; notificação real preserva título, destino e demais opções',async()=>{
 let push,options;const scope={self:{addEventListener:(n,f)=>{if(n==='push')push=f;},registration:{scope:'https://quemfazservico.com.br/',showNotification:async(t,o)=>{assert.equal(t,'Pedido');options=o;}},location:{origin:'https://quemfazservico.com.br'}},clients:{matchAll:async()=>[]},Date,URL,fetch:async()=>({ok:true})};
 vm.runInNewContext(fs.readFileSync('sw.js','utf8'),scope);let done;
 push({data:{json:()=>({title:'Pedido',body:'Teste',url:'/#/profissional/pedido/123'})},waitUntil:p=>{done=p;}});await done;
 assert.equal(options.badge,'/assets/notifications/quemfaz-badge-96.png?v=1');assert.equal(options.icon,'./icon-192.png?v=20261013');assert.equal(options.data.url,'/#/profissional/pedido/123');
});
test('Ícones PNG são brancos, transparentes e seguem as densidades Android',()=>{
 const read=require('./helpers/png-rgba.cjs');
 for(const [density,size] of [['mdpi',24],['hdpi',36],['xhdpi',48],['xxhdpi',72],['xxxhdpi',96]]){
  const im=read('android-notification-fix/app/src/main/res/drawable-'+density+'/ic_stat_quemfaz.png');assert.equal(im.width,size);assert.equal(im.height,size);let opaque=0;
  for(let i=0;i<im.pixels.length;i+=4){if(im.pixels[i+3])assert.deepEqual([...im.pixels.subarray(i,i+3)],[255,255,255]);if(im.pixels[i+3]>128)opaque++;}
  assert.ok(opaque/(size*size)>0.15&&opaque/(size*size)<0.7);
  for(const index of [0,size-1,size*(size-1),size*size-1])assert.equal(im.pixels[index*4+3],0);
 }
 assert.match(fs.readFileSync('android-notification-fix/AndroidManifest.application-snippet.xml','utf8'),/default_notification_icon/);
 assert.match(fs.readFileSync('android-notification-fix/NotificationBuilder.kt.txt','utf8'),/setSmallIcon\(R.drawable.ic_stat_quemfaz\)/);
});
test('FCM usa o recurso nativo em mensagens de notificação e orienta o serviço data-only',async()=>{
 const src=fs.readFileSync('supabase/functions/quemfaz-push/index.ts','utf8');const a=src.indexOf('async function sendFcm('),b=src.indexOf('\nconst cors',a);
 const code=require('esbuild').transformSync(src.slice(a,b),{loader:'ts',format:'cjs'}).code;const messages=[];
 const ctx={getFcmAccessToken:async()=> 'test-token',fcmAccount:{project_id:'test'},fetch:async(url,o)=>{messages.push(JSON.parse(o.body).message);return {ok:true};},AbortSignal,console};
 vm.runInNewContext(code+'\nthis.sendFcmTest=sendFcm;',ctx);
 await ctx.sendFcmTest('device',{title:'Pedido',body:'Teste'},false);await ctx.sendFcmTest('device',{title:'Pedido',body:'Teste'},true);
 assert.equal(messages[0].android.notification.icon,'ic_stat_quemfaz');assert.equal(messages[0].data.small_icon,'ic_stat_quemfaz');assert.equal(messages[1].data.small_icon,'ic_stat_quemfaz');assert.equal(messages[1].notification,undefined);
});
