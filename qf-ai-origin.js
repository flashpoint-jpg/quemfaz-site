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
        var old=JSON.parse(g.sessionStorage.getItem(key)||'null');
        var internal=host===g.location.hostname;
        var row={source:source,medium:'ai_referral',landing_page:internal&&old&&old.source===source?old.landing_page:g.location.pathname};
        g.sessionStorage.setItem(key,JSON.stringify(row));
        g.sessionStorage.removeItem('qf_ads_attribution_v1');
        g.sessionStorage.removeItem('qf_search_referrer_v1');
        return row;
      }
      return JSON.parse(g.sessionStorage.getItem(key)||'null');
    }catch(_){return source&&!paid?{source:source,medium:'ai_referral',landing_page:g.location.pathname}:null;}
  }
  // Captura também nas páginas de catálogo, antes de o visitante abrir um formulário.
  function searchOrigin() {
    var key='qf_search_referrer_v1';
    var params=new URLSearchParams(g.location.search || '');
    var host='';
    try { host=new URL(g.document.referrer).hostname.toLowerCase(); } catch (_) {}
    var source=/^(?:www\.)?google\.(?:com(?:\.[a-z]{2})?|co\.[a-z]{2}|[a-z]{2,3})$/.test(host) ? 'google_referral'
      : /^(?:www\.)?bing\.com$/.test(host) ? 'bing_referral' : '';
    var tagged=['gclid','gbraid','wbraid','msclkid','ttclid','gad_campaignid','fbclid','utm_source','utm_medium','utm_campaign']
      .some(function(name){return !!params.get(name);});
    var current=null;
    if(source && !tagged){
      var url=g.location.pathname;
      current={source:source,medium:'organic',landing_page:/^\/(?:servicos(?:\/[a-z0-9-]+){0,2}\/)?$/.test(url)?url:'/'};
    }
    try {
      if (tagged || (!current && host && host!==g.location.hostname && !g.sessionStorage.getItem('qf_google_login_return'))) {
        g.sessionStorage.removeItem(key);
        return null;
      }
      if (current) g.sessionStorage.setItem(key,JSON.stringify(current));
      else current=JSON.parse(g.sessionStorage.getItem(key)||'null');
    } catch (_) {}
    return current;
  }
  g.QFAIOrigin={provider:provider,capture:capture};
  g.QFAIOrigin.current=capture();
  g.QFSearchOrigin=searchOrigin();
})(window);
