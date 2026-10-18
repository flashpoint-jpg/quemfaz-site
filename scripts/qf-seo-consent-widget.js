/* Componente isolado: integrar somente na tela autenticada de perfil profissional.
   A tabela qf_seo_consentimentos deve existir antes de habilitar o recurso. */
(function(global){
  'use strict';
  const STATEMENT='Autorizo a exibição pública das informações profissionais que selecionei no Quem Faz Serviço, incluindo meu nome profissional, serviços oferecidos e regiões atendidas, para que clientes possam encontrar meu perfil na plataforma e em mecanismos de busca.';
  function mount(container,client,userId){
    if(!container || !client || !userId) throw Error('Sessão profissional necessária');
    const section=document.createElement('section');
    const heading=document.createElement('h3');heading.textContent='Visibilidade pública do perfil';
    const label=document.createElement('label');
    const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=false;
    label.append(checkbox,document.createTextNode(' '+STATEMENT));
    const details=document.createElement('p');details.textContent='Públicos: nome profissional, serviços e cidades atendidas. Nunca: telefone privado, CPF, endereço residencial, dados financeiros ou coordenadas exatas.';
    const privacy=document.createElement('a');privacy.href='/politica-de-privacidade';privacy.textContent='Política de privacidade';
    const status=document.createElement('p');status.setAttribute('role','status');
    const save=document.createElement('button');save.type='button';save.textContent='Salvar preferência';save.disabled=true;
    section.append(heading,label,details,privacy,save,status);container.append(section);
    let loaded=false,original=false;
    client.from('qf_seo_consentimentos').select('autorizado').eq('profissional_id',userId).maybeSingle().then(({data,error})=>{
      if(error){status.textContent='Não foi possível carregar a preferência. Nenhuma autorização será registrada.';return;}
      original=Boolean(data&&data.autorizado);checkbox.checked=original;loaded=true;save.disabled=false;
    });
    save.addEventListener('click',async()=>{
      if(!loaded)return;
      save.disabled=true;
      const enabled=checkbox.checked;
      const {error}=await client.from('qf_seo_consentimentos').upsert({
        profissional_id:userId,autorizado:enabled,
        autorizado_em:enabled?new Date().toISOString():null,
        atualizado_em:new Date().toISOString()
      },{onConflict:'profissional_id'});
      if(error){checkbox.checked=original;status.textContent='Falha ao salvar. Sua preferência anterior foi mantida.';}
      else{original=enabled;status.textContent=enabled?'Autorização registrada.':'Autorização revogada.';}
      save.disabled=false;
    });
  }
  global.QFSeoConsent={mount,statement:STATEMENT};
})(window);
