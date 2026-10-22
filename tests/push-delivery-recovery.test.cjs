const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync(__dirname+'/../supabase/functions/quemfaz-push/index.ts','utf8');
const block=source.slice(source.indexOf('type PushOutcome'),source.indexOf('\nfunction newCallPayload'));
async function scenario(devices,failures={}){
 const outcomes=[],attempts=[];
 const admin={from(table){return {select(){return this},in(){return this},eq(){return Promise.resolve({data:table==='qf_push_subscriptions'?devices:[],error:null})},update(){return this},then(resolve){resolve({data:[],error:null})}}}};
 const context={admin,FCM_PREFIX:'fcm:',fcmAccount:{},ensureVapid:async()=>true,sendFcm:async(t)=>{attempts.push(t);return failures[t]?'error':'ok'},webpush:{sendNotification:async(s)=>{attempts.push(s.endpoint);if(failures[s.endpoint])throw {statusCode:typeof failures[s.endpoint]==='number'?failures[s.endpoint]:503}}},Intl,Date,console,Set};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(block)+'\nglobalThis.run=sendToUsers;',context);
 const result=await context.run(['success','partial','failed','missing'],{strong:true},{},async o=>outcomes.push(o));return {result,outcomes,attempts};
}
test('audita resultado por profissional, sem confundir reserva ou aparelho ausente com envio',async()=>{
 const d=(u,e)=>({id:e,user_id:u,endpoint:e,user_agent:'',p256dh:'x',auth_key:'y'});
 const {result,outcomes}=await scenario([d('success','web-ok'),d('partial','fcm:ok'),d('partial','web-fail'),d('failed','web-fail')],{'web-fail':true});
 assert.equal(result.sent,2);assert.deepEqual(outcomes.map(x=>[x.user_id,x.status]),[['success','enviado'],['partial','enviado'],['failed','falhou'],['missing','sem_inscricao']]);
});

for (const status of [401,403,404,410,503]) test('provedor HTTP '+status+': somente 404/410 invalidam inscrição', async()=>{
 const updates=[];
 const admin={from(table){return {select(){return this},in(){return this},update(value){updates.push(value);return this},eq(){return Promise.resolve({data:table==='qf_push_subscriptions'?[{id:'s',user_id:'u',endpoint:'https://push.example',p256dh:'p',auth_key:'a'}]:[],error:null})}}}};
 const context={admin,FCM_PREFIX:'fcm:',fcmAccount:null,ensureVapid:async()=>true,webpush:{sendNotification:async()=>{throw {statusCode:status}}},Intl,Date,console,Set};
 vm.createContext(context);vm.runInContext(stripTypeScriptTypes(block)+'\nglobalThis.run=sendToUsers;',context);
 const outcomes=[];await context.run(['u'],{},undefined,async o=>outcomes.push(o));
 assert.equal(updates.length,[404,410].includes(status)?1:0);assert.equal(outcomes[0].status,'falhou');assert.equal(outcomes[0].error,'web_push_'+status);
});
