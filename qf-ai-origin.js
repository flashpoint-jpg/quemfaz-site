// Origem de busca por IA: apenas evidências do URL ou referenciador; nunca inferir pela página visitada.
(function(g){
  'use strict';
  function provider(value) {
    var host=String(value||'').trim().toLowerCase().replace(/^www\./,'');
    if (/^(chatgpt|chatgpt\.com|chat\.openai\.com)$/.test(host)) return 'chatgpt';
    if (/^(perplexity|perplexity\.ai)$/.test(host)) return 'perplexity';
    if (/^(gemini|gemini\.google\.com)$/.test(host)) return 'gemini';
    if (/^(copilot|copilot\.microsoft\.com)$/.test(host)) return 'copilot';
    if (/^(claude|claude\.ai)$/.test(host)) return 'claude';
    return '';
  }
  function capture(){
    var p=new URLSearchParams(g.location.search||'');
    var paid=['gclid','gbraid','wbraid','msclkid','ttclid','gad_campaignid','fbclid'].some(function(k){return p.has(k);}) ||
      /^(cpc|ppc|paid|paid_social|display|cpm)$/i.test(p.get('utm_medium')||'');
    var source=provider(p.get('utm_source'));
    var host='';
    try{host=new URL(g.document.referrer).hostname;}catch(_){}
    if(!source && !p.get('utm_source')) source=provider(host);
    var key='qf_ai_origin_v1';
    try{
      if(paid || (p.get('utm_source')&&!source) || (host && host!==g.location.hostname && !source)){
        g.sessionStorage.removeItem(key);return null;
      }
      if(source){
        var row={source:source,medium:'ai_referral',landing_page:g.location.pathname};
        g.sessionStorage.setItem(key,JSON.stringify(row));
        g.sessionStorage.removeItem('qf_ads_attribution_v1');
        g.sessionStorage.removeItem('qf_search_referrer_v1');
        return row;
      }
      return JSON.parse(g.sessionStorage.getItem(key)||'null');
    }catch(_){return source&&!paid?{source:source,medium:'ai_referral',landing_page:g.location.pathname}:null;}
  }
  g.QFAIOrigin={provider:provider,capture:capture};
  g.QFAIOrigin.current=capture();
})(window);
