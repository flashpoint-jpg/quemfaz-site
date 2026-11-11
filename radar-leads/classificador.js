/* Radar de Leads: classificação local de publicações fornecidas por fonte autorizada.
   Não realiza scraping, envio de mensagens ou acesso a grupos privados. */
(function(root){
  'use strict';
  const servicos = [
    ['encanador', /\b(encanador|encanamento|vazamento|tubula[cç][aã]o|caixa d.?[aá]gua)\b/i],
    ['diarista', /\b(diarista|faxina|faxineir[ao]|limpeza residencial)\b/i],
    ['pintor', /\b(pintor|pintura de parede|pintar (a |minha |meu )?(casa|apartamento|parede))\b/i]
  ];
  const procura = /\b(preciso|procuro|procurando|algu[eé]m indica|indica[cç][aã]o|necessito|contratar|or[cç]amento)\b/i;
  const descarte = /\b(vaga|curr[ií]culo|estamos contratando|contrata.se|oportunidade de emprego|curso|ofere[cç]o meus servi[cç]os|sou (pintor|diarista|encanador))\b/i;
  function classificar(texto){
    const t=String(texto||'').slice(0,5000);
    const profissao=servicos.find(([_,re])=>re.test(t));
    if(!t.trim()) return {status:'descartada',motivo:'texto vazio',profissao:null};
    if(descarte.test(t)) return {status:'descartada',motivo:'emprego ou oferta de serviços',profissao:profissao?.[0]||null};
    if(!profissao) return {status:'revisao',motivo:'profissão não identificada',profissao:null};
    if(!procura.test(t)) return {status:'revisao',motivo:'intenção de contratação incerta',profissao:profissao[0]};
    return {status:'potencial',motivo:'possível solicitação de serviço; verificar local e data',profissao:profissao[0]};
  }
  root.RadarClassificador={classificar};
})(typeof window!=='undefined'?window:globalThis);
