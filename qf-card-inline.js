(function(global){
  'use strict';
  var PAYEE_CODE='4d6402950655c75fbb9cdb020bea5d94';
  var EFI_SDK='https://cdn.jsdelivr.net/gh/efipay/js-payment-token-efi/dist/payment-token-efi-umd.min.js';
  var sdkPromise=null;

  function loadSdk(){
    if(global.EfiPay&&global.EfiPay.CreditCard)return Promise.resolve(global.EfiPay);
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise(function(resolve,reject){
      var s=document.createElement('script');
      s.src=EFI_SDK;s.async=true;
      s.onload=function(){global.EfiPay&&global.EfiPay.CreditCard?resolve(global.EfiPay):reject(new Error('Biblioteca de pagamento não carregou.'));};
      s.onerror=function(){reject(new Error('Não foi possível carregar a biblioteca segura da Efí.'));};
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  function digits(v){return String(v||'').replace(/\D/g,'');}
  function esc(v){return global.PU&&PU.escapeHtml?PU.escapeHtml(String(v||'')):String(v||'');}
  function money(c){return global.PU&&PU.formatCurrency?PU.formatCurrency(c):('R$ '+(Number(c||0)/100).toFixed(2).replace('.',','));}
  function selectedValue(btn){
    var custom=document.getElementById('wallet-custom-value');
    var customCents=global.PU&&PU.parseCurrencyInput&&custom?PU.parseCurrencyInput(custom.value):0;
    return customCents>0?customCents:Number(btn.getAttribute('data-wallet-selected-value')||5000);
  }
  function currentUser(){
    try{var s=global.DB&&DB.getSession?DB.getSession():null;return s&&s.userId&&DB.profissionalById?DB.profissionalById(s.userId):null;}catch(_){return null;}
  }
  function errorText(e){if(!e)return'Não foi possível processar o pagamento.';if(typeof e==='string')return e;return e.error_description||e.message||e.error||'Não foi possível processar o pagamento.';}

  async function updateInstallments(valor){
    var number=digits((document.getElementById('qf-card-number')||{}).value);
    var select=document.getElementById('qf-card-installments');
    var hint=document.getElementById('qf-card-brand');
    if(!select||number.length<13)return;
    try{
      var Efi=await loadSdk();
      var brand=await Efi.CreditCard.setCardNumber(number).verifyCardBrand();
      if(!brand||brand==='unsupported'||brand==='undefined')throw new Error('Bandeira do cartão não reconhecida.');
      select.dataset.brand=brand;
      if(hint)hint.textContent='Bandeira: '+String(brand).toUpperCase();
      var info=await Efi.CreditCard.setAccount(PAYEE_CODE).setEnvironment('production').setBrand(brand).setTotal(Number(valor)).getInstallments();
      var list=(info&&info.installments)||[];
      if(!list.length)list=[{installment:1,value:Number(valor),currency:(Number(valor)/100).toFixed(2).replace('.',',')}];
      select.innerHTML=list.map(function(i){
        var n=Number(i.installment||1);
        var cur=i.currency||(Number(i.value||0)/100).toFixed(2).replace('.',',');
        return '<option value="'+n+'">'+n+'x de R$ '+esc(cur)+(i.has_interest?' com juros':'')+'</option>';
      }).join('');
    }catch(e){
      if(hint)hint.textContent=errorText(e);
      select.dataset.brand='';
      select.innerHTML='<option value="1">1x</option>';
    }
  }

  function openCardSheet(valor){
    var u=currentUser()||{};
    var html=''
      +'<div class="stack">'
      +'<div class="icon-tile icon-tile--lg icon-tile--orange" style="margin:0 auto;">'+(global.icon?icon('creditCard'):'')+'</div>'
      +'<h3 class="sheet__title" style="text-align:center;">Pagar com cartão</h3>'
      +'<p class="text text--secondary" style="text-align:center;">'+money(valor)+' · pagamento seguro sem sair do QuemFaz.</p>'
      +'<label class="field"><span class="field__label">Nome completo</span><input class="input" id="qf-card-name" autocomplete="name" value="'+esc(u.nome||'')+'"></label>'
      +'<label class="field"><span class="field__label">CPF</span><input class="input" id="qf-card-cpf" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00"></label>'
      +'<label class="field"><span class="field__label">E-mail</span><input class="input" id="qf-card-email" type="email" autocomplete="email" value="'+esc(u.email||'')+'"></label>'
      +'<label class="field"><span class="field__label">Celular</span><input class="input" id="qf-card-phone" inputmode="tel" autocomplete="tel" value="'+esc(u.telefone||'')+'"></label>'
      +'<label class="field"><span class="field__label">Número do cartão</span><input class="input" id="qf-card-number" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000"></label>'
      +'<div id="qf-card-brand" class="text--sm text--secondary"></div>'
      +'<div class="row"><label class="field spacer"><span class="field__label">Validade</span><input class="input" id="qf-card-exp" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AAAA"></label><label class="field" style="width:120px;"><span class="field__label">CVV</span><input class="input" id="qf-card-cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="123"></label></div>'
      +'<label class="field"><span class="field__label">Nome no cartão</span><input class="input" id="qf-card-holder" autocomplete="cc-name" placeholder="NOME COMO NO CARTÃO"></label>'
      +'<label class="field"><span class="field__label">Parcelas</span><select class="select" id="qf-card-installments"><option value="1">1x</option></select></label>'
      +'<button class="btn btn--primary" id="qf-card-pay">Pagar '+money(valor)+'</button>'
      +'<button class="btn btn--outline" id="qf-card-close">Cancelar</button>'
      +'<p class="text--sm text--secondary" style="text-align:center;">Os dados do cartão são tokenizados pela Efí no seu aparelho. O QuemFaz não salva número do cartão nem CVV.</p>'
      +'</div>';
    PU.openSheet(html);

    var timer=null;
    var number=document.getElementById('qf-card-number');
    if(number)number.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(function(){updateInstallments(valor);},650);});
    var close=document.getElementById('qf-card-close');
    if(close)close.onclick=function(){PU.closeSheet();};

    var pay=document.getElementById('qf-card-pay');
    if(pay)pay.onclick=async function(){
      pay.disabled=true;pay.textContent='Processando...';
      try{
        var name=String(document.getElementById('qf-card-name').value||'').trim();
        var cpf=digits(document.getElementById('qf-card-cpf').value);
        var email=String(document.getElementById('qf-card-email').value||'').trim();
        var phone=digits(document.getElementById('qf-card-phone').value);
        var cardNumber=digits(document.getElementById('qf-card-number').value);
        var cvv=digits(document.getElementById('qf-card-cvv').value);
        var holder=String(document.getElementById('qf-card-holder').value||'').trim();
        var exp=String(document.getElementById('qf-card-exp').value||'').trim().split('/');
        var month=digits(exp[0]||'');
        var year=digits(exp[1]||'');
        if(year.length===2)year='20'+year;
        if(name.length<3)throw new Error('Informe seu nome completo.');
        if(cpf.length!==11)throw new Error('Informe um CPF válido.');
        if(!email||email.indexOf('@')<1)throw new Error('Informe um e-mail válido.');
        if(phone.length<10)throw new Error('Informe um celular válido.');
        if(cardNumber.length<13)throw new Error('Confira o número do cartão.');
        if(month.length!==2||year.length!==4)throw new Error('Informe a validade no formato MM/AAAA.');
        if(cvv.length<3)throw new Error('Confira o CVV.');
        if(holder.length<3)holder=name;

        var Efi=await loadSdk();
        var blocked=await Efi.CreditCard.isScriptBlocked();
        if(blocked)throw new Error('O navegador bloqueou a verificação de segurança da Efí. Desative o bloqueador e tente novamente.');
        var brand=document.getElementById('qf-card-installments').dataset.brand||'';
        if(!brand)brand=await Efi.CreditCard.setCardNumber(cardNumber).verifyCardBrand();
        if(!brand||brand==='unsupported'||brand==='undefined')throw new Error('Cartão não suportado ou número inválido.');

        var tokenResult=await Efi.CreditCard
          .setAccount(PAYEE_CODE)
          .setEnvironment('production')
          .setCreditCardData({brand:brand,number:cardNumber,cvv:cvv,expirationMonth:month,expirationYear:year,holderName:holder,holderDocument:cpf,reuse:false})
          .getPaymentToken();
        if(!tokenResult||!tokenResult.payment_token)throw new Error('Não foi possível proteger os dados do cartão.');

        var client=global.QFCloud&&QFCloud.client;
        if(!client)throw new Error('Conexão de pagamento indisponível.');
        var rec=await client.rpc('qf_solicitar_recarga',{p_valor_centavos:Number(valor),p_metodo:'cartao'});
        if(rec.error)throw rec.error;
        var row=rec.data||{};
        if(!row.recarga_id)throw new Error('Não foi possível criar a recarga.');

        var installments=Number(document.getElementById('qf-card-installments').value||1);
        var charge=await client.functions.invoke('quemfaz-efi-checkout',{body:{tipo:'recarga',pagamento_id:row.recarga_id,payment_token:tokenResult.payment_token,installments:installments,customer:{name:name,cpf:cpf,email:email,phone_number:phone}}});
        if(charge.error)throw charge.error;
        var result=charge.data||{};
        if(!result.ok)throw new Error(result.refusal||'Pagamento não autorizado.');
        if(result.status==='aprovado'){
          await QFCloud.syncForCurrentSession(true);
          PU.closeSheet();
          PU.toast('Pagamento aprovado. Créditos liberados.','success');
          if(global.navigate)global.navigate('/profissional/carteira',true);
          return;
        }
        if(result.status==='cancelado')throw new Error(result.refusal||'Pagamento não autorizado. Tente outro cartão.');
        await QFCloud.syncForCurrentSession(true);
        PU.closeSheet();
        PU.toast('Pagamento recebido e aguardando confirmação.','success');
        if(global.navigate)global.navigate('/profissional/carteira',true);
      }catch(e){
        PU.toast(errorText(e),'danger');
        pay.disabled=false;pay.textContent='Pagar '+money(valor);
      }
    };
  }

  document.addEventListener('click',function(e){
    var btn=e.target&&e.target.closest?e.target.closest('[data-action="iniciar-recarga"]'):null;
    if(!btn)return;
    var method=btn.getAttribute('data-wallet-selected-method')||'pix';
    if(method!=='cartao')return;
    e.preventDefault();e.stopImmediatePropagation();
    var valor=selectedValue(btn);
    if(valor<500){PU.toast('A recarga mínima é R$ 5,00.','danger');return;}
    openCardSheet(valor);
  },true);

  loadSdk().catch(function(){});
})(window);
