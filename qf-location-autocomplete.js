/* Sugestões locais: municípios e bairros oficiais do IBGE. Sem envio do texto digitado a terceiros. */
(function(global){
'use strict';
let dataPromise;
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function load(){if(!dataPromise)dataPromise=fetch('./data/localidades.json').then(r=>{if(!r.ok)throw Error('Dados indisponíveis');return r.json();}).catch(e=>{dataPromise=null;throw e;});return dataPromise;}
function cityMatches(data,query){const q=norm(query).replace(/\s*[,/-]\s*/g,' ');return data.cidades.filter(c=>norm(c[1]+' '+c[2]).includes(q)).sort((a,b)=>Number(norm(b[1]).startsWith(q))-Number(norm(a[1]).startsWith(q))).slice(0,8);}
function neighborhoodMatches(data,id,query){const q=norm(query);return (data.bairros[id]||[]).filter(n=>norm(n).includes(q)).slice(0,10);}
// Só completa a UF quando o município é inequívoco ou o estado foi informado.
function exactRegion(data,query,uf){
 const raw=String(query||'').trim(),parts=raw.match(/^(.*?)\s*[,/–-]\s*([A-Za-z]{2})$/);
 const name=norm(parts?parts[1]:raw),state=String(parts?parts[2]:(uf||'')).toUpperCase();
 const matches=data.cidades.filter(c=>norm(c[1])===name&&(!state||c[2]===state));
 return matches.length===1?{cidade:matches[0][1],uf:matches[0][2],id:matches[0][0]}:null;
}
// Leitura tolerante do campo de cidade do pedido: entende "sao paulo sp", "SP", "São Paulo capital",
// nome que existe em mais de um estado (prefere o estado de atuação) e erro de uma letra em cidade de SP.
// Só responde quando há uma única leitura razoável; no resto, quem decide é o cliente, tocando na lista.
const HOME_UF='SP',HOME_CITY='São Paulo';
const clean=s=>norm(s).replace(/[.,;:/\\|()–—-]+/g,' ').replace(/\s+/g,' ').trim().replace(/^cidade de /,'').replace(/ (capital|cidade)$/,'');
function distance(a,b,max){
 if(Math.abs(a.length-b.length)>max)return max+1;
 let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const cur=[i];let best=i;for(let j=1;j<=b.length;j++){cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(cur[j]<best)best=cur[j];}if(best>max)return max+1;prev=cur;}
 return prev[b.length];
}
function guessRegion(data,query,uf){
 const found=c=>c?{cidade:c[1],uf:c[2],id:c[0]}:null;
 const raw=String(query||'').trim(),sep=raw.match(/^(.*?)\s*[,/–-]\s*([A-Za-z]{2})$/);
 let name=clean(sep?sep[1]:raw),state=String(sep?sep[2]:(uf||'')).toUpperCase();
 if(!name)return null;
 if((!state||state===HOME_UF)&&(name===norm(HOME_UF)||name===norm(HOME_UF+' '+HOME_UF)))return found(data.cidades.find(c=>c[1]===HOME_CITY&&c[2]===HOME_UF));
 const byName=(n,st)=>data.cidades.filter(c=>norm(c[1])===n&&(!st||c[2]===st));
 // Sem estado informado, só aceita sozinho o que é do estado de atuação: "Lapa" e "Penha" são bairros
 // da capital e também cidades de outros estados; nesses casos o cliente confirma na lista.
 const pick=(list,st)=>st?(list.length===1?list[0]:null):(list.find(c=>c[2]===HOME_UF)||null);
 let hit=pick(byName(name,state),state);
 if(!hit){
  // "sao paulo sp": estado escrito no fim, sem vírgula nem barra.
  const tail=name.match(/^(.+) ([a-z]{2})$/),tailUf=tail&&tail[2].toUpperCase();
  if(tail&&data.cidades.some(c=>c[2]===tailUf)&&(!state||state===tailUf)){name=tail[1];state=tailUf;hit=pick(byName(name,state),state);}
 }
 // Erro de uma letra só é corrigido quando o texto não é, ele mesmo, nome de cidade ("Ipiranga").
 if(!hit&&name.length>=6&&(!state||state===HOME_UF)&&!byName(name).length){
  const near=data.cidades.filter(c=>c[2]===HOME_UF&&distance(name,norm(c[1]),1)<=1);
  if(near.length===1)hit=near[0];
 }
 return found(hit);
}
// Cidades para o cliente tocar quando o texto não foi reconhecido: as que combinam com o que ele
// escreveu e, sempre, a capital. Parecidas de longe ficam por último e só do estado de atuação.
function suggestRegions(data,query){
 const name=clean(query).replace(/ [a-z]{2}$/,m=>data.cidades.some(c=>c[2]===m.trim().toUpperCase())?'':m);
 const local=data.cidades.filter(c=>c[2]===HOME_UF),homeFirst=(a,b)=>Number(b[2]===HOME_UF)-Number(a[2]===HOME_UF);
 const begins=name.length<4?[]:local.filter(c=>norm(c[1]).startsWith(name)).sort((a,b)=>a[1].length-b[1].length).slice(0,3);
 const same=data.cidades.filter(c=>norm(c[1])===name).sort(homeFirst).slice(0,2);
 const close=name.length<5?[]:data.cidades.filter(c=>distance(name,norm(c[1]),1)===1).sort(homeFirst).slice(0,2);
 const far=name.length<6?[]:local.filter(c=>distance(name,norm(c[1]),2)===2).slice(0,2);
 const out=[];
 for(const c of begins.concat(same,close.filter(c=>c[2]===HOME_UF),local.filter(c=>c[1]===HOME_CITY),close,far))if(!out.includes(c)&&out.length<5)out.push(c);
 return out;
}
function bind(cityInput,bairroInput,onRegion,options){
 options=options||{};
 if(!cityInput||!bairroInput)return;
 let selected=null,sequence=0,cepTimer,offered=false;
 function box(input,id){const el=document.createElement('div');el.id=id;el.className='qf-location-options';el.hidden=true;el.setAttribute('role','listbox');(input.closest('.qf-home-location')||input.parentElement).insertAdjacentElement('afterend',el);input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',id);input.setAttribute('aria-expanded','false');input.autocomplete='off';return el;}
 const cityBox=box(cityInput,'qf-city-options'),bairroBox=box(bairroInput,'qf-bairro-options');
 const status=document.createElement('div');status.className='text--sm text--secondary';status.setAttribute('role','status');bairroBox.insertAdjacentElement('afterend',status);
 function close(input,el){el.hidden=true;input.setAttribute('aria-expanded','false');}
 function show(input,el,items,choose){el.replaceChildren();items.forEach((item,i)=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.textContent=item.label;button.addEventListener('click',()=>{choose(item.value);close(input,el);});button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();el.children[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length].focus();}if(e.key==='Escape'){close(input,el);input.focus();}});el.appendChild(button);});el.hidden=!items.length;input.setAttribute('aria-expanded',String(!!items.length));}
 function region(r){selected=r;onRegion(r);}
 async function resolveRegion(uf){
  const raw=cityInput.value.trim(),token=sequence;offered=false;
  if(selected&&norm(raw)===norm(options.cityOnly?selected.cidade:selected.cidade+' / '+selected.uf)&&(!uf||selected.uf===uf))return selected;
  if(!raw)return null;
  try{
   const r=/^\d{5}-?\d{3}$/.test(raw)?await global.QFGeo.lookupCep(raw):(options.tolerant?guessRegion:exactRegion)(await load(),raw,uf);
   if(token!==sequence||raw!==cityInput.value.trim()||!cityInput.isConnected)return null;
   if(r){region(r);cityInput.value=options.cityOnly?r.cidade:r.cidade+' / '+r.uf;if(!bairroInput.value.trim()&&r.bairro)bairroInput.value=r.bairro;close(cityInput,cityBox);status.textContent='';return r;}
   if(options.tolerant&&!uf&&!/^\d/.test(raw)){
    // Não reconheceu: mostra cidades para tocar. O toque escolhe a cidade e segue sem redigitar nada.
    const data=await load(),home=c=>c[1]===HOME_CITY&&c[2]===HOME_UF;
    sequence++;
    show(cityInput,cityBox,suggestRegions(data,raw).map(c=>({label:c[1]+' / '+c[2],value:c})),c=>{
     const semBairro=!bairroInput.value.trim();
     select(c);
     // Quem escreveu o bairro no campo da cidade ("Itaquera") não perde o que digitou.
     if(semBairro&&home(c)&&distance(clean(raw),norm(c[1]),2)>2&&raw.length<=60)bairroInput.value=raw;
     if(options.onPick)options.onPick(c);
    });
    // Fica na tela até o cliente tocar numa cidade ou voltar a digitar: no celular, o toque em
    // "publicar" dispara a perda de foco junto com o envio e a lista sumiria antes de ser vista.
    offered=!cityBox.hidden;status.textContent='';return null;
   }
   await cities();status.textContent='Selecione sua cidade e o estado na lista para continuar.';
  }catch(_){status.textContent='Não foi possível confirmar a cidade. Digite cidade / UF ou tente novamente.';}
  return null;
 }
 function select(c){sequence++;offered=false;region({cidade:c[1],uf:c[2],id:c[0]});cityInput.value=options.cityOnly?c[1]:c[1]+' / '+c[2];if(!options.keepBairro)bairroInput.value='';status.textContent='';close(bairroInput,bairroBox);if(!bairroInput.value.trim())bairroInput.focus();}
 async function cities(){const token=++sequence,raw=cityInput.value.trim();offered=false;close(cityInput,cityBox);if(raw.length<2||/^\d/.test(raw))return;try{const data=await load();if(token!==sequence||!cityInput.isConnected)return;show(cityInput,cityBox,cityMatches(data,raw).map(c=>({label:c[1]+' / '+c[2],value:c})),select);}catch(_){status.textContent='Você pode digitar a cidade / UF e o bairro.';}}
 async function neighborhoods(){const raw=cityInput.value;try{const data=await load();if(raw!==cityInput.value||!bairroInput.isConnected)return;let c=selected&&data.cidades.find(c=>norm(c[1])===norm(selected.cidade)&&c[2]===selected.uf);if(!c&&options.tolerant){const g=guessRegion(data,raw);if(g){c=data.cidades.find(x=>x[0]===g.id);region(g);}}
 if(!c&&!options.tolerant){const matches=data.cidades.filter(c=>norm(c[1]+' / '+c[2])===norm(raw)||norm(c[1])===norm(raw));if(matches.length===1){c=matches[0];region({cidade:c[1],uf:c[2],id:c[0]});}}
 if(!c){close(bairroInput,bairroBox);status.textContent='Selecione a cidade para ver os bairros. Você também pode digitar o bairro.';return;}
 const matches=neighborhoodMatches(data,c[0],bairroInput.value);show(bairroInput,bairroBox,matches.map(n=>({label:n,value:n})),n=>{bairroInput.value=n;status.textContent='';bairroInput.focus();});status.textContent=matches.length?'':'Não encontrou? Digite o nome do seu bairro.';
 }catch(_){status.textContent='Digite o nome do seu bairro para continuar.';}}
 cityInput.addEventListener('input',()=>{region(null);if(!options.keepBairro)bairroInput.value='';close(bairroInput,bairroBox);status.textContent='';clearTimeout(cepTimer);cities();const raw=cityInput.value.trim();if(/^\d{5}-?\d{3}$/.test(raw)){const token=sequence;cepTimer=setTimeout(async()=>{status.textContent='Consultando CEP…';try{const r=await global.QFGeo.lookupCep(raw);if(token!==sequence||cityInput.value.trim()!==raw||!cityInput.isConnected)return;region(r);cityInput.value=options.cityOnly?r.cidade:r.cidade+' / '+r.uf;bairroInput.value=r.bairro||'';status.textContent=r.bairro?'':'Digite o bairro do serviço.';}catch(_){if(token===sequence)status.textContent='CEP não encontrado. Digite sua cidade e bairro.';}},350);}});
 cityInput.addEventListener('focus',cities);bairroInput.addEventListener('focus',neighborhoods);bairroInput.addEventListener('input',neighborhoods);
 for(const [input,el] of [[cityInput,cityBox],[bairroInput,bairroBox]]){input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!el.hidden&&el.firstChild){e.preventDefault();el.firstChild.focus();}if(e.key==='Escape')close(input,el);});input.closest('form').addEventListener('focusout',()=>{setTimeout(()=>{if(el===cityBox&&offered)return;if(document.activeElement!==input&&!el.contains(document.activeElement))close(input,el);},0);});}
 return {resolveRegion,hasOptions:()=>offered&&!cityBox.hidden,setRegion:r=>{sequence++;clearTimeout(cepTimer);region(r);close(cityInput,cityBox);close(bairroInput,bairroBox);status.textContent='';}};
}
global.QFLocationAutocomplete={bind,cityMatches,neighborhoodMatches,exactRegion,guessRegion,suggestRegions};
})(window);
