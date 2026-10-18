/* Radar de Leads Externos — classificador conservador (Node e navegador).
   Não publica pedidos, não contata ninguém e não processa fontes não autorizadas.
   Só aceita texto de fonte aprovada; remove e-mail, telefone, CPF e @usuários do trecho guardado. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QFRadarClassifier = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // slug = valor aceito pelo parâmetro ?servico= do formulário existente (qf-client-acquisition.js).
  var SERVICES = [
    { label: 'limpeza de sofá', slug: 'limpeza_sofa', phrase: 'limpeza de sofá',
      re: /\b(limp\w*|lav\w*|higieniz\w*)( \w+){0,2} (sofa|sofas|estofado|estofados|colchao)\b|\b(sofa|estofado)s? (sujo|manchado)|higienizacao/ },
    { label: 'faxina pós-obra', slug: 'faxina_pos_obra', phrase: 'faxina pós-obra',
      re: /\b(faxina|limpeza) pos obra\b|\bpos obra\b/ },
    { label: 'pintor', slug: 'pintor', phrase: 'um pintor', re: /\b(pintor|pintora|pintura|pintar|pintando)\b/ },
    { label: 'eletricista', slug: 'eletricista', phrase: 'um eletricista',
      re: /\b(eletricista|tomada|tomadas|disjuntor|instalacao eletrica|curto circuito|fiacao)\b/ },
    { label: 'encanador', slug: 'encanador', phrase: 'um encanador',
      re: /\b(encanador|vazamento|torneira|cano estourado|hidraulica|hidraulico)\b/ },
    { label: 'desentupidor', slug: 'desentupidor', phrase: 'um desentupidor', re: /\b(desentup\w+|entupid\w+)\b/ },
    { label: 'diarista', slug: 'diarista', phrase: 'uma diarista',
      re: /\b(diarista|faxineira|faxina|limpeza residencial)\b/ },
    { label: 'montador de móveis', slug: 'montador', phrase: 'um montador de móveis',
      re: /\b(montador|montagem de (moveis|movel|guarda roupa|cozinha|armario)|montar (um |uns |o |os |meu |meus |minha |minhas )?(moveis|movel|guarda roupa|armario|cama|rack|cozinha|estante|painel))\b/ },
    { label: 'pedreiro', slug: 'pedreiro', phrase: 'um pedreiro', re: /\b(pedreiro|alvenaria|reboco)\b/ },
    { label: 'telhadista', slug: 'telhadista', phrase: 'um telhadista', re: /\b(telhadista|telhado|telhas?|calha|goteira)\b/ },
    { label: 'chaveiro', slug: 'chaveiro', phrase: 'um chaveiro',
      re: /\b(chaveiro|fechadura|chave (quebrou|presa|trancada)|perdi (a |minha )?chave)\b/ },
    { label: 'antenista', slug: 'antenista', phrase: 'um antenista', re: /\b(antenista|antena)\b/ },
    { label: 'marido de aluguel', slug: 'marido_aluguel', phrase: 'um marido de aluguel', re: /\bmarido de aluguel\b/ },
    { label: 'gesseiro', slug: 'gesseiro', phrase: 'um gesseiro', re: /\b(gesseiro|forro de gesso|drywall)\b/ },
    { label: 'azulejista', slug: 'azulejista', phrase: 'um azulejista', re: /\b(azulejista|assentar (azulejo|porcelanato|piso))\b/ },
    { label: 'impermeabilização', slug: 'impermeabilizacao', phrase: 'impermeabilização', re: /\b(impermeabiliz\w+|infiltracao)\b/ },
    { label: 'limpeza de caixa d’água', slug: 'caixa_dagua', phrase: 'limpeza de caixa d’água', re: /\bcaixa d ?agua\b/ }
  ];

  // Grande ABC primeiro, depois outras regiões atendidas. Os apelidos são comparados sem acento e em minúsculas.
  var CITIES = [
    { name: 'Santo André', aliases: ['santo andre', 'sto andre'] },
    { name: 'São Bernardo do Campo', aliases: ['sao bernardo do campo', 'sao bernardo', 'sbc'] },
    { name: 'São Caetano do Sul', aliases: ['sao caetano do sul', 'sao caetano'] },
    { name: 'Diadema', aliases: ['diadema'] },
    { name: 'Mauá', aliases: ['maua'] },
    { name: 'Ribeirão Pires', aliases: ['ribeirao pires'] },
    { name: 'Rio Grande da Serra', aliases: ['rio grande da serra'] },
    { name: 'São Paulo', aliases: ['sao paulo capital', 'sao paulo'] },
    { name: 'Guarulhos', aliases: ['guarulhos'] },
    { name: 'Osasco', aliases: ['osasco'] },
    { name: 'Barueri', aliases: ['barueri'] },
    { name: 'Santana de Parnaíba', aliases: ['santana de parnaiba'] },
    { name: 'Cotia', aliases: ['cotia'] },
    { name: 'Taboão da Serra', aliases: ['taboao da serra'] },
    { name: 'Embu das Artes', aliases: ['embu das artes'] },
    { name: 'Carapicuíba', aliases: ['carapicuiba'] },
    { name: 'Mogi das Cruzes', aliases: ['mogi das cruzes'] },
    { name: 'Suzano', aliases: ['suzano'] },
    { name: 'Itaquaquecetuba', aliases: ['itaquaquecetuba'] },
    { name: 'Arujá', aliases: ['aruja'] },
    { name: 'Poá', aliases: ['poa sp'] },
    { name: 'Ferraz de Vasconcelos', aliases: ['ferraz de vasconcelos'] },
    { name: 'Mairiporã', aliases: ['mairipora'] },
    { name: 'Franco da Rocha', aliases: ['franco da rocha'] },
    { name: 'Caieiras', aliases: ['caieiras'] },
    { name: 'Jundiaí', aliases: ['jundiai'] },
    { name: 'Campinas', aliases: ['campinas'] },
    { name: 'Sorocaba', aliases: ['sorocaba'] },
    { name: 'São José dos Campos', aliases: ['sao jose dos campos'] },
    { name: 'Taubaté', aliases: ['taubate'] },
    { name: 'Jacareí', aliases: ['jacarei'] },
    { name: 'Ribeirão Preto', aliases: ['ribeirao preto'] },
    { name: 'Santos', aliases: ['baixada santista', 'santos sp', 'em santos'] },
    { name: 'São Vicente', aliases: ['sao vicente'] },
    { name: 'Guarujá', aliases: ['guaruja'] },
    { name: 'Praia Grande', aliases: ['praia grande'] },
    { name: 'Bauru', aliases: ['bauru'] },
    { name: 'Piracicaba', aliases: ['piracicaba'] },
    { name: 'Limeira', aliases: ['limeira'] },
    { name: 'Americana', aliases: ['americana'] },
    { name: 'Indaiatuba', aliases: ['indaiatuba'] },
    { name: 'São José do Rio Preto', aliases: ['sao jose do rio preto', 'rio preto'] },
    { name: 'Rio de Janeiro', aliases: ['rio de janeiro'] },
    { name: 'Niterói', aliases: ['niteroi'] },
    { name: 'Belo Horizonte', aliases: ['belo horizonte', 'bh mg'] },
    { name: 'Contagem', aliases: ['contagem'] },
    { name: 'Uberlândia', aliases: ['uberlandia'] },
    { name: 'Juiz de Fora', aliases: ['juiz de fora'] },
    { name: 'Curitiba', aliases: ['curitiba'] },
    { name: 'Londrina', aliases: ['londrina'] },
    { name: 'Maringá', aliases: ['maringa'] },
    { name: 'Porto Alegre', aliases: ['porto alegre'] },
    { name: 'Florianópolis', aliases: ['florianopolis'] },
    { name: 'Joinville', aliases: ['joinville'] },
    { name: 'Blumenau', aliases: ['blumenau'] },
    { name: 'Salvador', aliases: ['salvador ba', 'em salvador'] },
    { name: 'Recife', aliases: ['recife'] },
    { name: 'Fortaleza', aliases: ['fortaleza'] },
    { name: 'Brasília', aliases: ['brasilia'] },
    { name: 'Goiânia', aliases: ['goiania'] },
    { name: 'Manaus', aliases: ['manaus'] },
    { name: 'Belém', aliases: ['belem pa', 'em belem'] },
    { name: 'Vitória', aliases: ['vitoria es'] },
    { name: 'Campo Grande', aliases: ['campo grande ms', 'em campo grande'] },
    { name: 'Cuiabá', aliases: ['cuiaba'] },
    { name: 'Natal', aliases: ['em natal'] },
    { name: 'João Pessoa', aliases: ['joao pessoa'] },
    { name: 'Maceió', aliases: ['maceio'] },
    { name: 'Aracaju', aliases: ['aracaju'] },
    { name: 'São Luís', aliases: ['sao luis ma', 'em sao luis'] },
    { name: 'Teresina', aliases: ['teresina'] },
    { name: 'Muzambinho', aliases: ['muzambinho'] }
  ];

  // Só bairros inequívocos (nomes que existem em uma única cidade da região).
  var NEIGHBORHOODS = {
    'Santo André': ['vila assuncao', 'campestre', 'vila pires', 'parque das nacoes', 'vila luzita', 'utinga', 'vila humaita',
      'jardim bela vista', 'vila alpina', 'parque capuava', 'jardim do estadio', 'vila guiomar', 'bangu', 'vila scarpelli',
      'parque novo oratorio', 'vila metalurgica'],
    'São Bernardo do Campo': ['rudge ramos', 'baeta neves', 'jardim do mar', 'planalto', 'ferrazopolis', 'nova petropolis',
      'santa terezinha', 'vila euclides', 'demarchi', 'riacho grande', 'alvarenga', 'batistini', 'montanhao', 'paulicea'],
    'São Caetano do Sul': ['santa paula', 'barcelona', 'fundacao', 'olimpico', 'osvaldo cruz', 'oswaldo cruz', 'nova gerty', 'prosperidade'],
    'Diadema': ['eldorado', 'serraria', 'canhema', 'piraporinha', 'inamar', 'vila nogueira', 'jardim ruyce', 'casa grande'],
    'Mauá': ['vila noemia', 'parque sao vicente', 'jardim zaira', 'vila bocaina', 'vila magini', 'jardim pilar', 'sonia maria'],
    'Ribeirão Pires': ['ouro fino paulista', 'suisso'],
    'Rio Grande da Serra': []
  };

  var NEED_VERBS = ['preciso', 'precisando', 'procuro', 'procurando', 'quero contratar', 'gostaria de contratar',
    'alguem indica', 'alguem conhece', 'alguem sabe de', 'alguem recomenda', 'alguem que faca', 'alguem que faz',
    'tem alguem', 'indica um', 'indica uma', 'indicar um', 'indicar uma'];
  var INTENTS = NEED_VERBS.concat(['indicacao', 'contratar', 'orcamento', 'recomenda', 'recomendam', 'quanto custa']);
  var OFFER = ['sou pintor', 'sou pintora', 'sou eletricista', 'sou encanador', 'sou diarista', 'sou pedreiro', 'sou chaveiro',
    'ofereco meus servicos', 'ofereco servicos', 'prestamos servicos', 'presto servicos', 'contrate nossos', 'contrate meus',
    'faco servicos', 'fazemos', 'atendo toda', 'atendemos', 'orcamento sem compromisso', 'chama no whats', 'chame no whats',
    'chame no zap', 'trabalho com', 'servico de qualidade', 'anos de experiencia', 'divulgacao'];
  var URGENT = ['urgente', 'urgencia', 'ainda hoje', 'hoje', 'agora', 'o quanto antes', 'amanha', 'emergencia', 'para ja', 'vazando'];

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function containsPhrase(haystack, needle) {
    return (' ' + haystack + ' ').indexOf(' ' + normalize(needle) + ' ') !== -1;
  }
  function containsAny(haystack, list) {
    for (var i = 0; i < list.length; i++) if (containsPhrase(haystack, list[i])) return true;
    return false;
  }

  var CONTACT_RE = /(\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|wa\.me\/|whatsapp\.com\/|chat\.whatsapp/i;

  // Mesma regra aplicada pelo banco (private.qf_radar_redact); o banco refaz a limpeza por segurança.
  function redact(text) {
    return String(text == null ? '' : text)
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[e-mail removido]')
      .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, '[documento removido]')
      .replace(/(\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/g, '[telefone removido]')
      .replace(/(^|\s)@[A-Za-z0-9_.]{2,}/g, '$1[usuário removido]')
      .trim().slice(0, 500);
  }

  function findService(plain) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].re.test(plain)) return SERVICES[i];
    return null;
  }
  function findCity(plain) {
    for (var i = 0; i < CITIES.length; i++) {
      if (containsAny(plain, CITIES[i].aliases)) return CITIES[i].name;
    }
    return null;
  }
  function findNeighborhood(plain, city) {
    var names = Object.keys(NEIGHBORHOODS);
    for (var i = 0; i < names.length; i++) {
      if (city && names[i] !== city) continue;
      var list = NEIGHBORHOODS[names[i]];
      for (var j = 0; j < list.length; j++) {
        if (containsPhrase(plain, list[j])) return { city: names[i], name: list[j] };
      }
    }
    return null;
  }
  function titleCase(text) {
    return text.replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }).replace(/\b(De|Da|Do|Das|Dos)\b/g, function (c) { return c.toLowerCase(); });
  }

  /**
   * record: { authorizedSource: true, url, source, text }
   * Retorna sempre um objeto; `accepted` só é true para pedido real de contratação na região.
   */
  function classifyLead(record) {
    if (!record || record.authorizedSource !== true) return { accepted: false, reason: 'fonte_nao_autorizada' };
    var url;
    try { url = new URL(record.url); } catch (e) { return { accepted: false, reason: 'url_invalida' }; }
    if (url.protocol !== 'https:' || !url.hostname) return { accepted: false, reason: 'url_invalida' };

    var body = String(record.text || '').slice(0, 3000);
    var plain = normalize(body);
    var service = findService(plain);
    var city = findCity(plain);
    var hood = findNeighborhood(plain, city);
    if (!city && hood) city = hood.city;
    var needs = containsAny(plain, NEED_VERBS);
    var intent = containsAny(plain, INTENTS);
    var hasContact = CONTACT_RE.test(body);
    var asksQuestion = body.indexOf('?') !== -1;
    var isOffer = containsAny(plain, OFFER) || (hasContact && !needs && !asksQuestion);

    var reason = !service ? 'servico_nao_identificado'
      : !city ? 'fora_da_regiao'
      : isOffer ? 'possivel_oferta'
      : !intent ? 'sem_intencao_clara' : 'oportunidade';

    var urgency = containsAny(plain, URGENT) ? 'urgente' : null;
    var confidence = 0.5 + (needs ? 0.15 : 0) + (asksQuestion ? 0.1 : 0) + (hood ? 0.1 : 0) + (urgency ? 0.1 : 0)
      + (plain.length >= 40 ? 0.05 : 0) - (hasContact ? 0.1 : 0);
    confidence = Math.round(Math.max(0, Math.min(0.95, confidence)) * 100) / 100;

    return {
      accepted: reason === 'oportunidade',
      reason: reason,
      intent: reason === 'possivel_oferta' ? 'oferta_servico' : (reason === 'oportunidade' ? 'procura_profissional' : 'indefinido'),
      service: service ? service.label : null,
      service_slug: service ? service.slug : null,
      city: city || null,
      neighborhood: hood ? titleCase(hood.name) : null,
      urgency: urgency,
      confidence: confidence,
      source: String(record.source || '').slice(0, 100),
      source_url: url.toString(),
      excerpt: redact(body),
      status: 'novo',
      consent_status: 'nao_verificado'
    };
  }

  function inviteMessage(serviceLabel, link) {
    var item = null;
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].label === serviceLabel || SERVICES[i].slug === serviceLabel) item = SERVICES[i];
    var what = item ? item.phrase : 'um profissional';
    return 'Está procurando ' + what + '? Publique seu pedido gratuitamente no Quem Faz e receba até 4 contatos de profissionais da sua região. ' + link;
  }

  return { classifyLead: classifyLead, inviteMessage: inviteMessage, normalize: normalize, redact: redact,
    SERVICES: SERVICES, CITIES: CITIES };
});
