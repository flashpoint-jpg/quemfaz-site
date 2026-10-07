/* Sugestões locais: municípios e bairros oficiais do IBGE. Sem envio do texto digitado a terceiros. */
(function(global){
'use strict';
let dataPromise;
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function load(){if(!dataPromise)dataPromise=fetch('./data/localidades.json').then(r=>{if(!r.ok)throw Error('Dados indisponíveis');return r.json();}).catch(e=>{dataPromise=null;throw e;});return dataPromise;}
function cityMatches(data,query){const q=norm(query).replace(/\s*[,/-]\s*/g,' ');return data.cidades.filter(c=>norm(c[1]+' '+c[2]).includes(q)).sort((a,b)=>Number(norm(b[1]).startsWith(q))-Number(norm(a[1]).startsWith(q))).slice(0,8);}
function neighborhoodMatches(data,id,query){const q=norm(query);return (data.bairros[id]||[]).filter(n=>norm(n).includes(q)).slice(0,10);}
function bind(cityInput,bairroInput,onRegion){
 if(!cityInput||!bairroInput)return;
 let selected=null,sequence=0,cepTimer;
 function box(input,id){const el=document.createElement('div');el.id=id;el.className='qf-location-options';el.hidden=true;el.setAttribute('role','listbox');input.closest('.qf-home-location').insertAdjacentElement('afterend',el);input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',id);input.setAttribute('aria-expanded','false');input.autocomplete='off';return el;}
 const cityBox=box(cityInput,'qf-city-options'),bairroBox=box(bairroInput,'qf-bairro-options');
 const status=document.createElement('div');status.className='text--sm text--secondary';status.setAttribute('role','status');bairroBox.insertAdjacentElement('afterend',status);
 function close(input,el){el.hidden=true;input.setAttribute('aria-expanded','false');}
 function show(input,el,items,choose){el.replaceChildren();items.forEach((item,i)=>{const button=document.createElement('button');button.type='button';button.setAttribute('role','option');button.textContent=item.label;button.addEventListener('click',()=>{choose(item.value);close(input,el);});button.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();el.children[(i+(e.key==='ArrowDown'?1:items.length-1))%items.length].focus();}if(e.key==='Escape'){close(input,el);input.focus();}});el.appendChild(button);});el.hidden=!items.length;input.setAttribute('aria-expanded',String(!!items.length));}
 function region(r){selected=r;onRegion(r);}
 function select(c){sequence++;region({cidade:c[1],uf:c[2],id:c[0]});cityInput.value=c[1]+' / '+c[2];bairroInput.value='';status.textContent='';close(bairroInput,bairroBox);bairroInput.focus();}
 async function cities(){const token=++sequence,raw=cityInput.value.trim();close(cityInput,cityBox);if(raw.length<2||/^\d/.test(raw))return;try{const data=await load();if(token!==sequence||!cityInput.isConnected)return;show(cityInput,cityBox,cityMatches(data,raw).map(c=>({label:c[1]+' / '+c[2],value:c})),select);}catch(_){status.textContent='Você pode digitar a cidade / UF e o bairro.';}}
 async function neighborhoods(){const raw=cityInput.value;try{const data=await load();if(raw!==cityInput.value||!bairroInput.isConnected)return;let c=selected&&data.cidades.find(c=>norm(c[1])===norm(selected.cidade)&&c[2]===selected.uf);if(!c){const matches=data.cidades.filter(c=>norm(c[1]+' / '+c[2])===norm(raw)||norm(c[1])===norm(raw));if(matches.length===1){c=matches[0];region({cidade:c[1],uf:c[2],id:c[0]});}}
 if(!c){close(bairroInput,bairroBox);status.textContent='Selecione a cidade para ver os bairros. Você também pode digitar o bairro.';return;}
 const matches=neighborhoodMatches(data,c[0],bairroInput.value);show(bairroInput,bairroBox,matches.map(n=>({label:n,value:n})),n=>{bairroInput.value=n;status.textContent='';bairroInput.focus();});status.textContent=matches.length?'':'Não encontrou? Digite o nome do seu bairro.';
 }catch(_){status.textContent='Digite o nome do seu bairro para continuar.';}}
 cityInput.addEventListener('input',()=>{region(null);bairroInput.value='';close(bairroInput,bairroBox);status.textContent='';clearTimeout(cepTimer);cities();const raw=cityInput.value.trim();if(/^\d{5}-?\d{3}$/.test(raw)){const token=sequence;cepTimer=setTimeout(async()=>{status.textContent='Consultando CEP…';try{const r=await global.QFGeo.lookupCep(raw);if(token!==sequence||cityInput.value.trim()!==raw||!cityInput.isConnected)return;region(r);cityInput.value=r.cidade+' / '+r.uf;bairroInput.value=r.bairro||'';status.textContent=r.bairro?'':'Digite o bairro do serviço.';}catch(_){if(token===sequence)status.textContent='CEP não encontrado. Digite sua cidade e bairro.';}},350);}});
 cityInput.addEventListener('focus',cities);bairroInput.addEventListener('focus',neighborhoods);bairroInput.addEventListener('input',neighborhoods);
 for(const [input,el] of [[cityInput,cityBox],[bairroInput,bairroBox]]){input.addEventListener('keydown',e=>{if(e.key==='ArrowDown'&&!el.hidden&&el.firstChild){e.preventDefault();el.firstChild.focus();}if(e.key==='Escape')close(input,el);});input.closest('form').addEventListener('focusout',()=>{setTimeout(()=>{if(document.activeElement!==input&&!el.contains(document.activeElement))close(input,el);},0);});}
 return {setRegion:r=>{sequence++;clearTimeout(cepTimer);region(r);close(cityInput,cityBox);close(bairroInput,bairroBox);status.textContent='';}};
}
global.QFLocationAutocomplete={bind,cityMatches,neighborhoodMatches};
})(window);
