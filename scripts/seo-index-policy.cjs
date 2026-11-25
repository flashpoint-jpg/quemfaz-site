// Prioridades editoriais do ABC, Guarulhos e São Paulo. O catálogo e as URLs
// antigas continuam disponíveis, mas só as combinações elegíveis entram no índice.
const localPriorities = {
  'santo-andre': ['eletricista', 'encanador', 'diarista', 'pintor', 'montador-de-moveis', 'marido-de-aluguel', 'vidraceiro', 'desentupidor'],
  'sao-bernardo-do-campo': ['eletricista', 'encanador', 'diarista', 'pintor', 'pedreiro', 'montador-de-moveis'],
  'sao-caetano-do-sul': ['eletricista', 'encanador', 'pintor', 'montador-de-moveis'],
  maua: ['eletricista', 'encanador', 'pintor', 'montador-de-moveis'],
  diadema: ['eletricista', 'encanador', 'diarista', 'chaveiro', 'tecnico-de-geladeira'],
  'ribeirao-pires': ['eletricista', 'encanador', 'pintor'],
  'rio-grande-da-serra': ['eletricista', 'encanador'],
  osasco: ['eletricista', 'encanador'],
  suzano: ['eletricista', 'pedreiro'],
  guarulhos: ['eletricista', 'encanador', 'diarista', 'pintor', 'pedreiro', 'montador-de-moveis', 'desentupidor', 'ar-condicionado', 'gasista'],
  'sao-paulo': ['eletricista', 'encanador', 'diarista', 'pintor', 'pedreiro', 'montador-de-moveis', 'limpeza-de-estofados-e-tapetes', 'faxina-pos-obra', 'gasista']
};

// Segmentação conferida em 14/11/2026: grupo Limpeza de Sofá e Estofados,
// campanha 24443887906, com anúncios ativos. São Paulo usa o cadastro local.
const sofaCampaignCities = new Set(['santo-andre', 'sao-bernardo-do-campo', 'maua', 'diadema']);
const sofaCities = new Set([...sofaCampaignCities, 'sao-paulo']);

function isPriorityRoute(route) {
  if (route === '/' || route.startsWith('/para-profissionais/')) return true;
  const [, area, service, city] = route.split('/');
  if (area !== 'servicos') return false;
  if (!city || city === 'abc') return true;
  if (service === 'cidades') return Object.hasOwn(localPriorities, city);
  if (service === 'limpeza-de-sofa') return sofaCities.has(city);
  return localPriorities[city]?.includes(service) ?? false;
}

const legacyGuideRoots = [
  'limpeza-de-sofa', 'higienizacao-de-sofa', 'lavagem-de-tapetes',
  'limpeza-de-colchas', 'limpeza-de-estofado', 'limpeza-pos-obra',
  'tecnico-em-automacao', 'tecnico-em-informatica', 'diarista', 'faxineira', 'pintor'
];

module.exports = { isPriorityRoute, sofaCities, sofaCampaignCities, legacyGuideRoots };
