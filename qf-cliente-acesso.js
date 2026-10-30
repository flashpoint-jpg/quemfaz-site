/* Acesso do cliente durante a publicação; usa o serviço de contas já implantado. */
(function(g){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const phone=v=>String(v||'').replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
 let active=null;
 async function call(acao,body={}){
  const c=g.QFCloud?.client;if(!c)throw Error('Conexão indisponível. Tente novamente.');
  const r=await c.functions.invoke('quemfaz-cliente-conta',{body:{...body,acao}});
  let out=r.data;
  if(r.error){try{out=await r.error.context.json();}catch(_){} }
  if(!out?.ok){const e=Error(out?.error||'Não foi possível concluir seu acesso. Tente novamente.');e.codigo=out?.codigo;throw e;}
  return out;
 }
 async function existing(telefone){
  const c=g.QFCloud?.client;if(!c?.auth?.getUser)return null;
  const r=await c.auth.getUser();const id=r.data?.user?.id;if(r.error||!id)return null;
  const p=await c.from('qf_profiles').select('id,tipo,nome,telefone,whatsapp').eq('id',id).maybeSingle();
  if(p.error||p.data?.tipo!=='cliente'||phone(p.data.whatsapp||p.data.telefone)!==phone(telefone))return null;
  return p.data;
 }
 async function googleCustomer(nome,telefone){
  const client=g.QFCloud?.client;
  if(!client?.auth?.getUser)return null;
  const {data,error}=await client.auth.getUser();
  if(error||!data?.user?.identities?.some(i=>i.provider==='google'))return null;
  // Função existente no servidor: valida JWT, titularidade e duplicidade de telefone.
  try{await call('google',{nome,telefone});}
  catch(err){
   // Telefone já pertence a uma conta: não vincular por suposição.
   // Voltar para o acesso original por senha ou primeiro acesso.
   if(err.codigo==='telefone_cadastrado'||/telefone do pedido não corresponde/i.test(err.message||'')){
    // Não misturar perfis diferentes apenas por telefone.
    await client.auth.signOut();
    const mismatch=Error('Este telefone já pertence a outra conta. Para publicar sem entrar nela, toque em Publicar sem cadastro. Seu pedido permanece preenchido.');
    mismatch.codigo='conta_google_diferente';
    throw mismatch;
   }
   throw err;
  }
  const profile=await existing(telefone);
  if(!profile)throw Error('Sua conta Google foi validada, mas não conseguimos confirmar o telefone do pedido.');
  await g.QFCloud.syncForCurrentSession(true);
  return profile;
 }
 async function guest(nome,telefone){
  const c=g.QFCloud?.client;
  if(!c?.functions?.invoke||!c?.auth?.verifyOtp)throw Error('A publicação sem cadastro está indisponível. Atualize a página e tente novamente.');
  const res=await c.functions.invoke('quemfaz-cliente-rapido',{body:{modo:'visitante',nome,telefone}});
  let data=res.data;
  if(res.error){try{data=await res.error.context.json();}catch(_){}}
  if(!data?.ok||data.guest!==true||!data.token_hash||!data.user_id)throw Error(data?.error||'Não foi possível preparar sua publicação sem cadastro.');
  const session=await c.auth.verifyOtp({type:'magiclink',token_hash:data.token_hash});
  if(session.error||session.data?.user?.id!==data.user_id)throw Error('Não conseguimos validar seu acesso de visitante. Seus dados permanecem preenchidos.');
  const profile=await existing(telefone);
  if(!profile||profile.id!==data.user_id)throw Error('A identificação de visitante não corresponde ao pedido. Seus dados permanecem preenchidos.');
  await g.QFCloud.syncForCurrentSession(true);
  return profile;
 }
 function authenticate({nome,telefone,container}){
  if(active)return active;
  active=(async()=>{
   const profile=await existing(telefone);
   if(profile)return profile;
   let warning='';
   try{
    const google=await googleCustomer(nome,telefone);
    if(google)return google;
   }catch(err){
    if(err.codigo!=='conta_google_diferente')throw err;
    warning=err.message;
   }
   return open({nome,telefone,container,warning});
  })().finally(()=>{active=null;});
  return active;
 }
 async function open({nome,telefone,container,warning=''}){
  const current=await existing(telefone);if(current)return current;
  return new Promise((resolve,reject)=>{
   const embedded=!!container;const dialog=g.document.createElement(embedded?'section':'dialog');dialog.className='qf-client-access';if(embedded)dialog.style.cssText='margin:16px 0;width:100%;max-height:none';
   dialog.setAttribute('aria-label','Acesso para publicar seu pedido');
   dialog.innerHTML='<style>.qf-client-access{width:min(440px,calc(100% - 24px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #dce6f3;border-radius:20px;padding:20px;color:#173150;background:#fff;box-sizing:border-box}.qf-client-access::backdrop{background:#10233a99}.qf-client-access h2{font-size:22px;margin:0 0 8px}.qf-client-access p{font-size:14px;line-height:1.45}.qf-client-access form,.qf-client-access label{display:flex;flex-direction:column;gap:9px}.qf-client-access form{gap:14px}.qf-client-access .input{width:100%;box-sizing:border-box}.qf-client-access .btn{min-height:46px;white-space:normal}.qf-client-access__links{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.qf-client-access__links button{padding:8px;background:#fff;border:1px solid #dce6f3;border-radius:9px;color:#075bbb;font:inherit;font-size:13px;cursor:pointer}.qf-client-access [role=alert]{color:#9b261c;min-height:1em;margin:0}.qf-client-access__cancel{margin-top:12px;width:100%}.qf-client-access__google{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1458cc;border:1.5px solid #b7cff0;font-weight:750;min-height:52px!important;margin:12px 0 4px}.qf-client-access__google img{width:22px;height:22px}.qf-client-access__or{text-align:center;color:#64748b;margin:8px 0 12px!important}.qf-client-access__guest{width:100%;display:block;background:#ff8200;color:#102a4f;border:1px solid #ff8200;min-height:54px!important;font-weight:850;border-radius:12px;font-size:17px;cursor:pointer}.qf-client-access__guest:disabled{opacity:.62;cursor:wait}</style><div data-access-body></div>';
   (container||g.document.body).appendChild(dialog);
   const host=dialog.querySelector('[data-access-body]');let mode='entrar',busy=false;
   const end=(value,error)=>{if(!embedded)dialog.close();dialog.remove();if(error)reject(error);else resolve(value);};
   dialog.addEventListener('cancel',e=>{e.preventDefault();if(!busy)end(null,Error('Seu pedido está salvo nesta tela. Entre para concluir a publicação.'));});
   function draw(message=''){
    const register=mode==='cadastrar',legacy=mode==='primeiro_acesso',forgot=mode==='esqueci_senha';
    host.innerHTML='<p style="display:inline-flex;background:#edf5ff;color:#1458cc;border-radius:12px;padding:6px 10px;font-weight:750;font-size:12px;margin:0 0 10px">Área do cliente · preciso contratar</p><h2>'+({entrar:'Como deseja publicar?',cadastrar:'Crie seu acesso grátis',primeiro_acesso:'Primeiro acesso com senha',esqueci_senha:'Recuperar minha senha'})[mode]+'</h2><p>Seu pedido está preenchido. Você pode publicar sem conta e sem senha. O acompanhamento ficará protegido neste navegador.</p><button type="button" class="btn btn--primary qf-client-access__guest" data-guest-publish>Publicar sem cadastro</button><p class="text--sm" style="margin:8px 0 12px;color:#52647c">Não exige Google, senha ou SMS. Para acessar em outro aparelho, pode ser necessária ajuda do suporte.</p><p class="qf-client-access__or">ou entre com sua conta</p><button type="button" class="btn btn--outline qf-client-access__google" data-google-login><img src="/assets/google-g.svg" alt="" width="22" height="22">Continuar com Google</button><p class="qf-client-access__or">ou</p><form novalidate>'+
    (!forgot?'<label>Telefone<input class="input" name="telefone" type="tel" autocomplete="tel" value="'+esc(telefone)+'" readonly></label>':'')+
    (register?'<label>Seu nome<input class="input" name="nome" autocomplete="name" value="'+esc(nome)+'" required></label>':'')+
    (legacy?'<label>Código de acesso antigo<input class="input" name="codigo" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label><p>Se ainda estiver conectado no aparelho anterior, publique por ele. Se perdeu o código e o acesso, fale com o suporte para recuperar sua conta.</p>':'')+
    (register||legacy||forgot?'<label>E-mail'+(forgot?' cadastrado':' para recuperar sua senha')+'<input class="input" name="email" type="email" autocomplete="email" required></label>':'')+
    (!forgot?'<label>'+(register||legacy?'Crie uma senha':'Sua senha')+'<input class="input" name="senha" type="password" autocomplete="'+(register||legacy?'new-password':'current-password')+'" '+(register||legacy?'minlength="6" ':'')+'required></label>'+(register||legacy?'<p>Senha simples com 6 ou mais posições. Pode usar só números ou só letras. Você receberá um e-mail para verificar seu endereço.</p>':''):'')+
    '<p role="alert">'+esc(message)+'</p><button class="btn btn--primary" type="submit">'+(forgot?'Enviar link de recuperação':register||legacy?'Criar acesso e continuar':'Entrar e publicar pedido')+'</button></form><p class="text--sm" style="border-top:1px solid #dce6f3;padding-top:12px;margin-top:12px"><strong>Quer se cadastrar para trabalhar?</strong> Este acesso é somente para clientes. <a href="/#/auth/profissional/login" style="color:#1458cc;font-weight:700">Ir para cadastro de profissionais</a>.</p><div class="qf-client-access__links">'+[['entrar','Já tenho senha'],['cadastrar','Criar conta'],['primeiro_acesso','Tenho cadastro antigo'],['esqueci_senha','Esqueci minha senha']].filter(x=>x[0]!==mode).map(x=>'<button type="button" data-access-mode="'+x[0]+'">'+x[1]+'</button>').join('')+'</div><button type="button" class="btn btn--outline qf-client-access__cancel" data-access-cancel>Voltar ao pedido</button>';
    host.querySelector('[data-guest-publish]').onclick=async()=>{
     if(busy)return;
     busy=true;const btn=host.querySelector('[data-guest-publish]');
     host.querySelectorAll('input,button').forEach(el=>el.disabled=true);
     if(btn)btn.textContent='Preparando publicação…';
     try{const profile=await guest(nome,telefone);end(profile);}
     catch(err){const notice=host.querySelector('[role=alert]');if(notice)notice.textContent=err.message||'Não foi possível publicar. Tente novamente.';}
     finally{busy=false;host.querySelectorAll('input,button').forEach(el=>el.disabled=false);if(btn?.isConnected)btn.textContent='Publicar sem cadastro';}
    };
    host.querySelector('[data-google-login]').onclick=async()=>{
     const client=g.QFCloud?.client;
     if(!client?.auth?.signInWithOAuth){host.querySelector('[role=alert]').textContent='Login Google indisponível no momento.';return;}
     try{
      // Salva o formulário cifrado antes do redirecionamento; o retorno é tratado na home.
      if(g.QFAtendimento?.hasActiveDraft?.()){
        await g.QFAtendimento.saveDraftForGoogle();
        try{g.sessionStorage.setItem('qf_google_publish_pending','1');}catch(_){}
      }
      // O retorno ao pedido tem prioridade sobre "Meus pedidos".
      try{g.sessionStorage.setItem('qf_google_login_return','1');}catch(_){}
      // O retorno OAuth deve usar URL canônica autorizada no Supabase, nunca hash/localhost/preview.
      const redirectTo='https://quemfazservico.com.br/?app=1';
      const result=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo,queryParams:{prompt:'select_account'}}});
      if(result.error)throw result.error;
     }catch(err){try{g.sessionStorage.removeItem('qf_google_login_return');}catch(_){}host.querySelector('[role=alert]').textContent=err.message||'Não foi possível entrar com Google.';}
    };
    host.querySelector('[data-access-cancel]').onclick=()=>end(null,Error('Seu pedido continua preenchido. Entre para concluir a publicação.'));
    host.querySelectorAll('[data-access-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.accessMode;draw();});
    const form=host.querySelector('form');form.onsubmit=async e=>{
     e.preventDefault();if(busy)return;
     if(!form.reportValidity())return;
     const data=Object.fromEntries(new g.FormData(form));
     if((register||legacy)&&(data.senha.length<6||data.senha.length>72)){form.querySelector('[role=alert]').textContent='Senha simples com 6 ou mais posições. Pode usar só números ou só letras.';return;}
     busy=true;host.querySelectorAll('input,button').forEach(b=>b.disabled=true);
     try{
      const out=await call(mode,data);
      if(forgot){form.querySelector('[role=alert]').textContent=out.mensagem||'Confira seu e-mail e a caixa de spam.';return;}
      if(!out.session?.access_token||!out.session?.refresh_token)throw Error('Não foi possível abrir sua sessão. Tente entrar novamente.');
      const s=await g.QFCloud.client.auth.setSession(out.session);if(s.error)throw Error('Não foi possível validar sua sessão. Tente novamente.');
      // A API publica somente para o proprietário autenticado; nunca cria sessão só pelo telefone.
      const user=await existing(telefone);if(!user)throw Error('Este acesso não corresponde ao telefone do pedido. Confira seus dados.');
      await g.QFCloud.syncForCurrentSession(true);
      end(user);
     }catch(err){
      form.querySelector('[role=alert]').textContent=err.message;
      if(err.codigo==='telefone_legado'){mode='primeiro_acesso';draw(err.message);}
      else if(err.codigo==='telefone_cadastrado'||err.codigo==='ja_tem_senha'){mode='entrar';draw(err.message);}
     }finally{busy=false;host.querySelectorAll('input,button').forEach(b=>b.disabled=false);}
    };
   }
   draw(warning);if(!embedded)dialog.showModal();else dialog.scrollIntoView({block:"nearest"});
  });
 }
 async function tokenPage(){
  const host=g.document.querySelector('[data-client-token]');if(!host||host.dataset.mounted)return;
  host.dataset.mounted='1';const kind=host.dataset.kind,token=host.dataset.token;
  if(!/^[A-Za-z0-9_-]{20,100}$/.test(token||'')){host.textContent='Link inválido. Solicite um novo link.';return;}
  if(kind==='verificar'){
   host.innerHTML='<h1 class="h2">Confirmar e-mail</h1><p>Confirme seu e-mail para recuperar sua senha quando precisar.</p><button type="button" class="btn btn--primary">Confirmar meu e-mail</button><p role="status"></p>';
   host.querySelector('button').onclick=async e=>{e.target.disabled=true;try{await call('verificar_email',{token});host.innerHTML='<h1 class="h2">E-mail confirmado</h1><p>Agora você pode recuperar sua senha por este e-mail.</p><a class="btn btn--primary" href="/?app=1#/auth/cliente/cadastro">Voltar ao Quem Faz</a>';}catch(err){host.querySelector('[role=status]').textContent=err.message;e.target.disabled=false;}};
  }else{
   host.innerHTML='<h1 class="h2">Criar nova senha</h1><form class="stack"><label>Nova senha<input class="input" name="senha" type="password" autocomplete="new-password" minlength="6" required></label><p>Senha simples com 6 ou mais posições. Pode usar só números ou só letras.</p><button type="submit" class="btn btn--primary">Salvar nova senha</button><p role="alert"></p></form>';
   host.querySelector('form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{await call('redefinir_senha',{token,senha:e.target.elements.senha.value});host.innerHTML='<h1 class="h2">Senha atualizada</h1><p>Entre com seu telefone e a nova senha ao publicar o pedido.</p><a class="btn btn--primary" href="/?app=1#/auth/cliente/cadastro">Voltar ao Quem Faz</a>';}catch(err){host.querySelector('[role=alert]').textContent=err.message;btn.disabled=false;}};
  }
 }
 g.QFClienteAcesso={authenticate,existing,guest,tokenPage};
 const install=()=>{if(!g.Screens)return false;if(g.QFClienteAcesso.installed)return true;g.QFClienteAcesso.installed=true;const login=g.Screens.authLogin;
 g.Screens.authLogin=function(params){if(params.role!=='cliente')return login.apply(this,arguments);return '<div class="view card stack" style="max-width:480px;margin:auto"><h1 class="h2">Entrar como cliente</h1><p>Use seu telefone e senha para ver seus pedidos.</p><form class="stack" data-client-login><label>Telefone<input class="input" type="tel" name="telefone" autocomplete="tel" required></label><button class="btn btn--primary" type="submit">Continuar</button><p role="alert"></p></form><a href="/?app=1#/auth/cliente/cadastro">Publicar um pedido grátis</a></div>';};
 const before=g.Screens.afterRenderAnon;g.Screens.afterRenderAnon=function(pattern,content,params){
  if(pattern==='/auth/:role/login'&&params.role==='cliente'){
   const form=content.querySelector('[data-client-login]');if(form)form.onsubmit=async e=>{e.preventDefault();if(!form.reportValidity())return;try{await authenticate({nome:'',telefone:form.elements.telefone.value});g.navigate('/cliente/home',true);}catch(err){form.querySelector('[role=alert]').textContent=err.message;}};
   return;
  }
  const r=before?.apply(this,arguments);tokenPage();return r;
 };tokenPage();return true;};
 if(!install()){const timer=g.setInterval(()=>{if(install())g.clearInterval(timer);},50);}
})(window);
