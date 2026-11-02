/* Quem Faz Foto — piloto independente. Não altera nem substitui o formulário atual. */
(function(w){
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const digits=s=>String(s||'').replace(/\D/g,'').replace(/^55(?=\d{11}$)/,'');
  const state={opened:false,busy:false,user:null,profile:null,photo:null,photoUrl:'',result:null,status:'',error:'',category:'',draft:{}};
  const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const categories=()=>w.DB?.categories?.().filter(x=>x.id!=='cat_outros')||[];
  const client=()=>w.QFCloud?.client;
  let overlay=null;
  function css(){
    if(document.querySelector('#qf-foto-style'))return;
    const st=document.createElement('style');st.id='qf-foto-style';
    st.textContent='.qff-entry{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;max-width:560px;margin:12px auto;padding:15px 18px;border:2px solid #f47a20;border-radius:15px;background:#fff8f2;color:#152e59;font-weight:850;cursor:pointer;box-shadow:0 5px 18px #132d5515}.qff-entry:hover{background:#fff0df}.qff-entry small{font-weight:500}.qff-dim{position:fixed;inset:0;z-index:2147480000;background:#051b36ad;display:grid;place-items:center;padding:10px;overflow-y:auto}.qff-panel{width:min(100%,565px);max-height:calc(100dvh - 20px);overflow-y:auto;background:#fff;color:#182f50;border-radius:22px;box-shadow:0 26px 70px #091b3659;padding:22px;font-family:system-ui,-apple-system,sans-serif}.qff-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.qff-head h2{font-size:22px;margin:0;color:#123c7a}.qff-panel p{line-height:1.48;margin:10px 0}.qff-panel label{display:block;font-weight:750;font-size:13px;margin:11px 0 5px}.qff-panel input:not([type=checkbox]):not([type=file]),.qff-panel textarea,.qff-panel select{box-sizing:border-box;display:block;width:100%;border:1px solid #cbd8e8;border-radius:11px;padding:12px;font-size:16px;background:#fff;color:#172b48}.qff-panel button{cursor:pointer}.qff-button{display:block;width:100%;padding:14px;border:0;border-radius:12px;background:#f47720;color:white;font-weight:800;font-size:16px;margin:14px 0 0}.qff-button:disabled{opacity:.5;cursor:wait}.qff-alt{border:1px solid #cbd8e8!important;background:white!important;color:#164b8c!important}.qff-x{border:0;background:#f0f4f8;padding:8px 12px;border-radius:50%;font-size:24px;color:#214466}.qff-file{border:2px dashed #b8cce1;border-radius:14px;padding:17px;text-align:center;margin-top:12px;background:#f7fbff}.qff-photo{display:block;max-height:220px;max-width:100%;object-fit:contain;margin:10px auto;border-radius:10px}.qff-result{background:#f1f7ff;border:1px solid #b5d2f3;border-radius:14px;padding:13px;margin:12px 0}.qff-error{color:#9d241f;background:#fff3f0;padding:12px;border-radius:10px;margin:12px 0}.qff-status{color:#17467e;background:#eef5ff;padding:12px;border-radius:10px;margin:12px 0}.qff-grid{display:grid;grid-template-columns:1fr 90px;gap:10px}.qff-consent{display:flex!important;align-items:flex-start;gap:10px;font-size:13px!important;font-weight:550!important;line-height:1.45}.qff-consent input{margin:3px 0 0}.qff-hint{font-size:12px;color:#5e7189}.qff-preview-pill{display:inline-block;background:#fff0dd;color:#734009;padding:4px 9px;border-radius:99px;font-size:12px;font-weight:750}@media(max-width:520px){.qff-panel{padding:17px;border-radius:18px}.qff-head h2{font-size:20px}}';
    document.head.appendChild(st);
  }
  function entry(){
    // O elemento dentro do card do pedido garante visibilidade na primeira dobra.
    // Ele é reposto caso o roteador redesenhe a home.
    const host=document.querySelector('#qf-pedido-facil')||
      document.querySelector('[data-landing-service-form]')||
      document.querySelector('.qf-landing-hero');
    if(!host)return;
    let button=document.getElementById('qff-entry');
    if(!button){
      button=document.createElement('button');
      button.type='button';button.id='qff-entry';button.className='qff-entry';
      button.innerHTML='<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f47720" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg><span>Descubra o profissional pela foto <small style="display:block">Sem preencher o formulário inicial · Grátis</small></span>';
      button.onclick=()=>open();
    }
    if(button.parentElement!==host)host.prepend(button);
  }
  async function account(){
    const c=client();if(!c?.auth?.getUser)return null;
    const auth=await c.auth.getUser();const u=auth.data?.user;
    if(auth.error||!u||u.app_metadata?.qf_guest===true||!u.identities?.some(x=>x.provider==='google')){state.user=null;state.profile=null;return null;}
    const p=await c.from('qf_profiles').select('id,tipo,nome,telefone,whatsapp').eq('id',u.id).maybeSingle();
    if(p.error)throw Error('Não foi possível conferir sua conta. Atualize a página.');
    if(p.data&&p.data.tipo!=='cliente')throw Error('Esta é uma conta profissional. Entre com uma conta de cliente.');
    state.user=u;state.profile=p.data||null;
    // Reaproveita localização de pedido anterior do próprio cliente quando disponível.
    try{
      const last=(w.DB?.state?.requests||[]).filter(x=>x.clienteId===u.id).sort((a,b)=>new Date(b.criadoEm||0)-new Date(a.criadoEm||0))[0];
      const loc=last?.endereco||{};
      for(const [key,value] of Object.entries({cidade:loc.cidade||'',uf:loc.uf||'',bairro:loc.bairro||''})){
        if(value&&!state.draft[key])state.draft[key]=String(value);
      }
    }catch(_){}
    return u;
  }
  async function login(){
    const c=client();if(!c?.auth?.signInWithOAuth)throw Error('Login Google não disponível.');
    sessionStorage.setItem('qff-abrir-apos-google','1');
    const r=await c.auth.signInWithOAuth({provider:'google',options:{redirectTo:w.location.origin+'/?app=1',queryParams:{prompt:'select_account'}}});
    if(r.error)throw r.error;
  }
  function content(){
    const nm=state.profile?.nome||state.user?.user_metadata?.full_name||state.user?.user_metadata?.name||'Cliente';
    const contact=digits(state.profile?.whatsapp||state.profile?.telefone);
    const photo=state.photoUrl?'<img class="qff-photo" alt="Foto escolhida para análise" src="'+esc(state.photoUrl)+'">':'';
    const options=categories().map(x=>'<option value="'+esc(x.id)+'" '+(state.category===x.id?'selected':'')+'>'+esc(x.nome)+'</option>').join('');
    let step='';
    if(!state.user){
      step='<p>Entre com Google uma única vez. Depois, você só tira a foto e confirma o pedido.</p><button type="button" class="qff-button" data-qff-login>Continuar com Google</button>';
    }else if(!state.result){
      step='<p>Olá, <strong>'+esc(nm)+'</strong>! Fotografe o defeito ou envie uma imagem. A análise sugere o profissional, mas não substitui avaliação técnica.</p><div class="qff-file"><strong>Selecione a foto do problema</strong><input aria-label="Selecionar foto do problema" style="margin:12px auto;max-width:100%" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" data-qff-file>'+photo+'<p class="qff-hint">A foto só será usada na análise e não será publicada automaticamente.</p></div><button class="qff-button" type="button" data-qff-analyze '+(!state.photo?'disabled':'')+'>Identificar profissional pela foto</button><button class="qff-button qff-alt" type="button" data-qff-manual>Escolher profissional manualmente</button>';
    }else{
      step='<div class="qff-result"><span class="qff-preview-pill">'+(state.result.manual?'Escolha manual':'Sugestão da foto — confirme')+'</span><p><strong>'+esc(state.result.titulo||'Profissional sugerido')+'</strong></p><p>'+esc(state.result.problema||'Confira o problema com o profissional.')+'</p></div><p>Olá, <strong>'+esc(nm)+'</strong>. Confira apenas os dados necessários para publicar.</p><form data-qff-publish><label>Profissional indicado<select name="categoria" required><option value="">Escolha a profissão</option>'+options+'</select></label><label>O que aconteceu?<textarea rows="2" minlength="8" maxlength="1500" name="descricao" required>'+esc(state.result.descricao||'')+'</textarea></label><label>Cidade e estado</label><div class="qff-grid"><input name="cidade" autocomplete="address-level2" placeholder="Cidade" required maxlength="100"><select name="uf" required><option value="">UF</option>'+'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').map(x=>'<option value="'+x+'">'+x+'</option>').join('')+'</select></div><label>Bairro</label><input name="bairro" placeholder="Bairro onde será o serviço" maxlength="100" required><label>Quando precisa?</label><select name="urgencia"><option value="hoje">Hoje</option><option value="normal">Sem pressa / a combinar</option><option value="urgente">Urgente</option></select>'+(!contact?'<label>Seu WhatsApp com DDD (primeira vez)</label><input name="telefone" type="tel" autocomplete="tel" required inputmode="numeric" placeholder="(11) 99999-9999">':'<p class="qff-hint">WhatsApp do cadastro: final '+esc(contact.slice(-4))+'</p>')+'<label class="qff-consent"><input name="consent" type="checkbox" required> Concordo em publicar este pedido e receber contatos de profissionais pelo Quem Faz. A publicação é gratuita.</label><button type="submit" class="qff-button">Publicar pedido grátis</button><button type="button" class="qff-button qff-alt" data-qff-restart>Trocar foto</button><p class="qff-hint">Seu pedido só será enviado após tocar em Publicar. A análise da foto é uma sugestão, não um diagnóstico.</p></form>';
    }
    overlay.innerHTML='<div class="qff-panel" role="dialog" aria-modal="true" aria-label="Quem Faz Foto"><div class="qff-head"><h2>Quem Faz <span style="color:#f47720">Foto</span></h2><button class="qff-x" aria-label="Fechar" data-qff-close>×</button></div><p class="qff-hint">Tire uma foto. Descubra quem pode resolver.</p>'+(state.error?'<div class="qff-error" role="alert">'+esc(state.error)+'</div>':'')+(state.status?'<div class="qff-status" role="status">'+esc(state.status)+'</div>':'')+step+'</div>';
    overlay.querySelector('[data-qff-close]').onclick=close;
    const file=overlay.querySelector('[data-qff-file]');
    if(file)file.onchange=async e=>{state.error='';const f=e.target.files?.[0];if(!f)return;if(f.size>8*1024*1024){state.error='Foto muito grande. Escolha uma imagem de até 8 MB.';content();return;}try{state.photo=await shrink(f);if(state.photoUrl)URL.revokeObjectURL(state.photoUrl);state.photoUrl=URL.createObjectURL(f);content();}catch(err){state.error=err.message||'Não foi possível abrir a foto.';content();}};
    const sign=overlay.querySelector('[data-qff-login]');if(sign)sign.onclick=()=>run(login);
    const analyze=overlay.querySelector('[data-qff-analyze]');if(analyze)analyze.onclick=()=>run(analyse);
    const manual=overlay.querySelector('[data-qff-manual]');if(manual)manual.onclick=()=>{state.error='';state.result={manual:true,titulo:'Escolha a profissão',problema:'Se preferir, informe o profissional sem análise por IA.',descricao:''};content();};
    const restart=overlay.querySelector('[data-qff-restart]');if(restart)restart.onclick=()=>{state.result=null;state.category='';state.draft={};content();};
    const form=overlay.querySelector('[data-qff-publish]');
    if(form){
      Object.entries(state.draft).forEach(([key,value])=>{const field=form.elements.namedItem(key);if(field&&field.type!=='checkbox')field.value=value;});
      form.addEventListener('input',e=>{if(e.target.name&&e.target.type!=='checkbox')state.draft[e.target.name]=e.target.value;});
      form.addEventListener('change',e=>{if(e.target.name&&e.target.type!=='checkbox')state.draft[e.target.name]=e.target.value;});
      form.onsubmit=e=>{e.preventDefault();for(const [k,v] of new FormData(form))if(k!=='consent')state.draft[k]=String(v);run(()=>publish(form));};
    }
  }
  async function shrink(file){
    if(!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type))throw Error('Use uma foto JPG, PNG ou WebP.');
    const blob=await new Promise((resolve,reject)=>{
      const u=URL.createObjectURL(file);const img=new Image();
      img.onload=()=>{URL.revokeObjectURL(u);const max=1000,ratio=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*ratio));canvas.height=Math.max(1,Math.round(img.height*ratio));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);canvas.toBlob(b=>b?resolve(b):reject(Error('Não conseguimos preparar esta foto.')),'image/jpeg',0.72);};
      img.onerror=()=>{URL.revokeObjectURL(u);reject(Error('Não foi possível ler a foto. Tente JPG ou PNG.'));};img.src=u;
    });
    if(blob.size>1500000)throw Error('Foto muito grande após compactação.');
    return await new Promise((resolve,reject)=>{const f=new FileReader();f.onload=()=>resolve(f.result);f.onerror=()=>reject(Error('Não foi possível preparar a foto.'));f.readAsDataURL(blob);});
  }
  async function analyse(){
    if(!state.photo)throw Error('Escolha uma foto para continuar.');
    if(!await account())throw Error('Entre com Google para analisar sua foto.');
    const c=client();
    state.status='Analisando a foto...';content();
    const r=await c.functions.invoke('quemfaz-foto-analisar',{body:{imagem:state.photo}});
    let data=r.data;if(r.error){try{data=await r.error.context.json();}catch(_){}}
    if(!data?.ok)throw Error(data?.error||'A análise está indisponível. Você pode escolher a profissão manualmente.');
    const name=norm(data.profissao),match=categories().find(x=>norm(x.nome)===name)||categories().find(x=>norm(x.nome).includes(name)||name.includes(norm(x.nome)));
    state.category=match?.id||'';state.result={titulo:data.profissao||'Profissão a confirmar',problema:data.possivel_problema||'A foto não permite confirmar o defeito.',descricao:data.descricao||''};
    state.status='';
  }
  async function publish(form){
    const c=client();if(!c||!w.QFCloud?.createCall)throw Error('Publicação indisponível. Atualize a página.');
    const u=await account();if(!u)throw Error('Entre com Google como cliente.');
    const f=new FormData(form);const phone=digits(state.profile?.whatsapp||state.profile?.telefone||f.get('telefone'));
    if(!/^[1-9]{2}9\d{8}$/.test(phone))throw Error('Informe um WhatsApp válido com DDD.');
    if(!f.get('consent'))throw Error('Confirme a autorização antes de publicar.');
    const cat=categories().find(x=>x.id===f.get('categoria'));if(!cat)throw Error('Escolha um profissional disponível.');
    const loc={cidade:String(f.get('cidade')||'').trim(),uf:String(f.get('uf')||'').trim(),bairro:String(f.get('bairro')||'').trim()};
    if(!loc.cidade||!loc.bairro||!loc.uf)throw Error('Confira cidade, estado e bairro.');
    const descricao=String(f.get('descricao')||'').trim();if(descricao.length<8||descricao.length>1500)throw Error('Descreva o problema em pelo menos 8 caracteres.');
    const nome=String(state.profile?.nome||u.user_metadata?.full_name||u.user_metadata?.name||'Cliente').trim();
    if(!state.profile||digits(state.profile.whatsapp||state.profile.telefone)!==phone){
      const r=await c.functions.invoke('quemfaz-cliente-conta',{body:{acao:'google',nome,telefone:phone}});
      let out=r.data;if(r.error){try{out=await r.error.context.json();}catch(_){}}
      if(!out?.ok)throw Error(out?.error||'Não foi possível confirmar seu WhatsApp. Entre pela opção normal para vincular seu telefone.');
      await account();
      if(w.QFCloud?.syncForCurrentSession)await w.QFCloud.syncForCurrentSession(true);
    }
    if(!w.QFAtendimento?.payload||!w.QFAcompanhamento?.draft||!w.QFAcompanhamento?.remember)throw Error('Atualize a página para publicar com segurança.');
    const id=crypto.randomUUID();const a={servico:cat.nome,detalhes:'outro',escopo:'avaliar',cidade:loc.cidade,uf:loc.uf,bairro:loc.bairro,urgencia:String(f.get('urgencia')||'hoje'),materiais:'combinar',nome,contato:phone,aceite_app:'sim',intencao:'contratar',autorizacao:'sim',visita_presencial:'nao',__problem:descricao};
    for(const q of w.QFAtendimento.questions(a)){if(q.choices&&!q.choices.some(x=>x[0]===a[q.key])){a[q.key]=(q.choices.find(x=>x[0]==='outro'||x[0]==='avaliar'||x[0]==='combinar')||q.choices[0])[0];}}
    const at=w.QFAtendimento.payload(a,id,cat.id);
    const secret=w.QFAcompanhamento.draft(id);at.segredo_acompanhamento=secret;
    state.status='Publicando seu pedido...';content();
    const req=await w.QFCloud.createCall({clienteId:u.id,categoriaId:cat.id,descricao:at.detalhes,endereco:{...loc,cep:''},urgencia:a.urgencia,atendimento:at,prioridade:false,maxOrcamentos:4});
    w.QFAcompanhamento.remember(req.id,secret);
    try{w.QFClientAcquisition?.published(req,cat.id);}catch(_){}
    state.draft={};close();if(w.QFPedidoHome?.published)await w.QFPedidoHome.published(req,{id:u.id,nome,telefone:phone,whatsapp:phone});
    else w.location.hash='#/cliente/pedidos';
  }
  async function run(fn){if(state.busy)return;state.busy=true;state.error='';try{await fn();}catch(e){state.error=String(e?.message||'Falha inesperada. Tente novamente.');state.status='';}finally{state.busy=false;if(state.opened)content();}}
  function close(){state.opened=false;overlay?.remove();overlay=null;state.status='';state.error='';}
  async function open(){
    css();if(state.opened)return;state.opened=true;overlay=document.createElement('div');overlay.className='qff-dim';document.body.appendChild(overlay);overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    content();try{await account();}catch(e){state.error=e.message;}if(state.opened)content();
  }
  function start(){
    css();entry();const root=document.getElementById('app-shell')||document.body;
    const obs=new MutationObserver(()=>entry());obs.observe(root,{childList:true,subtree:true});
    const direct=new URLSearchParams(location.search).get('qf_foto')==='1';
    if(sessionStorage.getItem('qff-abrir-apos-google')==='1'){
      sessionStorage.removeItem('qff-abrir-apos-google');setTimeout(()=>open(),400);
    }else if(direct){setTimeout(()=>open(),250);}
  }
  w.QFFoto={open,close};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})(window);
