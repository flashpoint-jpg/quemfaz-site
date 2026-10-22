const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const html=fs.readFileSync(__dirname+'/../index.html','utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('Android: perfil em recarga não desliga sino e comandos seguem o estado mais recente sem sobreposição',async()=>{
  const calls=[],waiting=[];
  let profile={online:true},session={role:'profissional',userId:'p'},now=10000;
  const window={Capacitor:{isPluginAvailable:()=>true,Plugins:{QFOnline:{setOnline(args){calls.push(args.online);return new Promise((resolve,reject)=>waiting.push({resolve,reject}));}}}}};
  const code=html.slice(html.indexOf('  // ---------- V12 (APK): serviço'),html.indexOf('  const REFUND_MSG ='));
  const scope={global:window,DB:{getSession:()=>session,profissionalById:()=>profile},Date:{now:()=>now},setTimeout(){},setInterval(){},document:{addEventListener(){}},window:{addEventListener(){}}};
  vm.runInNewContext(code,scope);
  const sync=window.QFNativeOnline.sync;
  const first=sync();sync();assert.deepEqual(calls,[true]);
  profile=undefined;waiting.shift().resolve();await first;await sync();
  assert.deepEqual(calls,[true],'Perfil temporariamente ausente preserva serviço');
  profile={online:false};const off=sync();sync();assert.deepEqual(calls,[true,false]);
  profile.online=true;waiting.shift().resolve();await off;
  assert.deepEqual(calls,[true,false,true],'Mudança durante envio é aplicada em sequência');
  waiting.shift().resolve();await flush();
  await sync();assert.equal(calls.length,3,'Estado já confirmado não recria notificação');
  session=null;now+=9000;const logout=sync();assert.equal(calls.at(-1),false);
  waiting.shift().reject(new Error('bridge unavailable'));await logout;
  const retry=sync();assert.equal(calls.at(-1),false);assert.equal(calls.length,5);
  waiting.shift().resolve();await retry;
});

test('toque: reutiliza áudio liberado, oferece recuperação se bloqueado e para vibração ao fechar',async()=>{
  let overlay=true,plays=0,vibrations=0,cleared=0,lateReject;
  const button={hidden:true,style:{display:'none'}};
  const ring={pause(){},play(){plays++;return Promise.reject(new Error('NotAllowedError'));}};
  const window={DB:{},PU:{callRingAudio:()=>ring},icon(){}};
  let code=html.slice(html.indexOf('/* QuemFaz V11.2 — tela cheia'),html.indexOf('/* QuemFaz V11.51 —'));
  code=code.replace('  global.QFCallAlert=', '  global.audioTest={start:startAudio,stop:stopAudio};\n  global.QFCallAlert=');
  vm.runInNewContext(code,{window,document:{getElementById:()=>overlay?{}:null,querySelector:()=>button},navigator:{vibrate(){vibrations++;}},setInterval:()=>1,clearInterval(){cleared++;},setTimeout(){}});
  window.audioTest.start();await flush();
  assert.equal(plays,1);assert.equal(button.hidden,false);assert.notEqual(button.style.display,'none');assert.ok(vibrations>0);
  window.audioTest.stop();assert.equal(ring.loop,false);assert.equal(cleared,1);
  ring.play=()=>new Promise((_,reject)=>{lateReject=reject;});
  window.audioTest.start();assert.equal(button.hidden,true);window.audioTest.stop();overlay=false;
  const before=vibrations;lateReject(new Error('late failure'));await flush();
  assert.equal(vibrations,before,'Falha tardia não reinicia vibração após fechar');
});

test('push Web: chamado agrupado antigo recupera alerta forte; mensagem comum continua normal',async()=>{
  const listeners={},notices=[],messages=[];
  const self={addEventListener:(name,fn)=>{listeners[name]=fn;},registration:{showNotification:async(title,options)=>notices.push(options)}};
  vm.runInNewContext(fs.readFileSync(__dirname+'/../sw.js','utf8'),{self,clients:{matchAll:async()=>[{postMessage:m=>messages.push(m)}]},Date,console});
  async function push(data){let task;listeners.push({data:{json:()=>data},waitUntil:p=>{task=p;}});await task;}
  await push({tag:'qf-new-calls-group',strong:false,grouped:true});
  assert.equal(notices[0].requireInteraction,true);assert.equal(messages[0].payload.strong,true);
  await push({tag:'qf-chat-123',strong:'0'});
  assert.equal(notices[1].requireInteraction,false);
});

test('servidor: pedidos normais distintos mantêm alertas fortes individuais',()=>{
  const source=fs.readFileSync(__dirname+'/../supabase/functions/quemfaz-push/index.ts','utf8');
  const code=source.slice(source.indexOf('function newCallPayload('),source.indexOf('// V11.13: aviso de chamado já detalhado'));
  const scope={};vm.runInNewContext(stripTypeScriptTypes(code)+';globalThis.payload=newCallPayload;',scope);
  const a=scope.payload({id:'a'}),b=scope.payload({id:'b'}),priority=scope.payload({id:'c',prioridade:true});
  assert.equal(a.strong,true);assert.equal(b.strong,true);assert.notEqual(a.tag,b.tag);assert.equal(priority.strong,true);
  assert.equal(source.includes('perUser[String(uid)] = groupedNormalPayload'),false,'Não rebaixa o terceiro pedido');
});
