// Uma página editorial por necessidade; sem multiplicar textos iguais por cidade.
const entries = [
 {
  slug:'chaveiro', name:'Chaveiro', category:'cat_chaveiro', city:'São Paulo', citySlug:'sao-paulo',
  lead:'Perdeu a chave ou precisa trocar a fechadura em São Paulo? Informe seu bairro, o tipo de porta e se precisa de abertura ou substituição para comparar propostas.',
  heading:'Abertura de porta e troca de fechadura são serviços diferentes',
  items:['Tipo de porta e fechadura, sem publicar dados de acesso.','Se a porta está apenas fechada ou trancada e se há chave quebrada.','Bairro, horário desejado e regras de entrada do condomínio.'],
  scenarios:['Abertura: explique a situação e pergunte se o profissional consegue avaliar a possibilidade de preservar a fechadura.','Troca: informe se já comprou a peça ou precisa que ela seja fornecida.','Cópias: diga o tipo de chave, sem compartilhar imagens que exponham informações de segurança.'],
  example:'Preciso de chaveiro em São Paulo, bairro [bairro], para [abrir porta/trocar fechadura]. A porta é [tipo] e a fechadura [modelo ou não sei]. Gostaria de saber visita, mão de obra e peças antes de confirmar.',
  compare:'Compare deslocamento, mão de obra, peças e eventual adicional por horário. Peça autorização prévia para serviços extras.',
  question:'A abertura exige trocar a fechadura?', answer:'Depende da fechadura e da situação. Peça avaliação e esclareça quais procedimentos e peças serão necessários antes de autorizar.',
  checklist:['Tenha um documento que permita comprovar o direito de acesso ao imóvel.','Confirme a identificação do profissional e o valor da visita.','Combine como serão cobradas peças ou tarefas além do pedido inicial.']
 },
 {
  slug:'pedreiro', name:'Pedreiro', category:'cat_pedreiro', city:'Guarulhos', citySlug:'guarulhos',
  lead:'Precisa de pequenos reparos de alvenaria em Guarulhos? Liste paredes, revestimentos e acabamentos para definir o que entra no orçamento antes de começar.',
  heading:'Pequena reforma: separe demolição, execução e acabamento',
  items:['Ambientes e medidas aproximadas da área que precisa de reparo.','Estado atual de paredes, piso e revestimentos.','Materiais disponíveis, retirada de resíduos e regras do condomínio.'],
  scenarios:['Reparo de reboco: descreva a área e sinais como descascamento ou umidade, para avaliação da causa.','Revestimento: diga se haverá retirada de peças antigas e se as novas já foram compradas.','Reforma com imóvel ocupado: indique os ambientes que podem ser liberados e a necessidade de proteger móveis.'],
  example:'Busco pedreiro em Guarulhos, bairro [bairro], para [tarefas] em uma área aproximada de [medidas]. O imóvel está [ocupado/vazio]. Quero proposta com preparação, materiais, acabamento e retirada de resíduos separados.',
  compare:'Compare a mesma metragem e as mesmas etapas. Combine quem compra os materiais, como serão aprovados extras e quais acabamentos serão entregues.',
  question:'Posso incluir retirada de parede no mesmo pedido?', answer:'Descreva a intenção, mas não autorize a retirada sem avaliação técnica e as autorizações necessárias. Alterações que afetem a estrutura exigem profissional habilitado.',
  checklist:['Liste cada etapa que deseja contratar, incluindo limpeza e descarte.','Verifique regras e autorizações do imóvel antes do início.','Combine prazo, etapas de pagamento e aprovação de alterações por escrito.']
 },
 {
  slug:'desentupidor', name:'Desentupidor', category:'cat_desentupidor', city:'São Paulo', citySlug:'sao-paulo',
  lead:'Pia, ralo ou vaso entupido em São Paulo? Conte onde a água acumula e se outros pontos também apresentam retorno para pedir uma avaliação com escopo claro.',
  heading:'Identifique os pontos afetados antes de solicitar o orçamento',
  items:['Se o entupimento está na pia, ralo, vaso ou em vários pontos.','Quando começou e se existe retorno ou transbordamento.','Produtos já aplicados e condições de acesso à tubulação.'],
  scenarios:['Pia: informe se o escoamento está lento ou completamente bloqueado.','Ralo ou vaso: descreva retorno, odor e outros pontos afetados, sem desmontar a instalação.','Condomínio: esclareça se o problema parece restrito à unidade e quem pode liberar o acesso às áreas comuns.'],
  example:'Preciso de desentupidor em São Paulo, bairro [bairro]. O problema afeta [pontos] desde [quando]. Há [retorno/escoamento lento]. Já foi aplicado [produto ou nenhum]. Quero avaliação e explicação da forma de cobrança antes de autorizar.',
  compare:'Pergunte se o preço é fechado, por metro ou por hora. Confirme visita, equipamentos, limite autorizado e como serão cobrados serviços adicionais.',
  question:'O valor anunciado inclui qualquer extensão da tubulação?', answer:'Não presuma que sim. Confirme a unidade de cobrança, a avaliação inicial e o valor máximo autorizado antes do trabalho. Peça que qualquer ampliação seja aprovada por você.',
  checklist:['Informe os produtos já utilizados e não misture substâncias para tentar liberar o cano.','Peça uma proposta que explique como o preço será calculado.','Combine teste de escoamento, limpeza do local e condições de eventual retorno.']
 },
 {
  slug:'telhadista', name:'Telhadista', category:'cat_telhadista', city:'Guarulhos', citySlug:'guarulhos',
  lead:'Goteira ou telhas danificadas em Guarulhos? Descreva os sinais percebidos de dentro do imóvel e as condições de acesso para organizar uma avaliação do telhado.',
  heading:'Goteira: relate o sinal sem presumir a origem da infiltração',
  items:['Tipo de cobertura, se souber, e quantidade de pavimentos.','Onde a água aparece e em quais condições de chuva.','Histórico de reparos e condições de acesso ao imóvel.'],
  scenarios:['Goteira em um cômodo: informe quando aparece e se há manchas no teto.','Telhas danificadas: relate o que pode observar de um local seguro, sem subir à cobertura.','Reparo anterior sem resultado: explique o que foi feito para o profissional avaliar o conjunto.'],
  example:'Procuro telhadista em Guarulhos, bairro [bairro], para avaliar [goteira/dano]. A cobertura é [tipo ou não sei] em imóvel de [pavimentos]. A água aparece em [local] quando [situação]. Quero proposta com avaliação, materiais e testes discriminados.',
  compare:'Compare diagnóstico, peças, acesso, proteção da área e remoção de resíduos. Combine condições de execução e o que será feito se a origem não estiver visível.',
  question:'A mancha no teto indica exatamente onde está o defeito?', answer:'A água pode percorrer caminhos antes de aparecer no interior. Peça avaliação da origem; trocar uma telha sem diagnóstico pode não resolver a infiltração.',
  checklist:['Registre os sinais de dentro do imóvel; não suba no telhado para fotografar.','Informe altura, acesso e reparos anteriores.','Combine execução em condições seguras, proteção do imóvel e critérios de conferência do reparo.']
 },
 {
  slug:'ar-condicionado', name:'Ar-condicionado', category:'cat_arcondicionado', city:'São Paulo', citySlug:'sao-paulo',
  lead:'Vai instalar um ar-condicionado em São Paulo? Informe modelo, capacidade e locais previstos para as unidades para comparar uma instalação com todos os materiais definidos.',
  heading:'Instalação de split: descreva os dois locais e o trajeto entre eles',
  items:['Marca, modelo e capacidade indicada em BTUs.','Local previsto para unidade interna e externa, com condições de acesso.','Existência de infraestrutura, drenagem e regras do condomínio.'],
  scenarios:['Aparelho novo: diga se está na embalagem e tenha o manual disponível.','Infraestrutura existente: informe se há tubulação e quando foi utilizada, para avaliação de compatibilidade.','Local externo com acesso difícil: descreva altura e restrições para o profissional avaliar a execução.'],
  example:'Quero instalar ar-condicionado [marca/modelo/BTUs] em São Paulo, bairro [bairro]. A unidade interna ficará em [local] e a externa em [local]. Há [infraestrutura ou não sei]. Quero proposta com materiais, drenagem, testes e eventuais adequações separados.',
  compare:'Confira extensão e especificação de tubulação, suportes, drenagem, testes e acabamento. Pergunte se adequações elétricas estão incluídas ou exigem outro profissional.',
  question:'Posso reaproveitar a tubulação de um aparelho antigo?', answer:'A compatibilidade depende do equipamento e das condições da infraestrutura. Informe os modelos e peça avaliação segundo as orientações do fabricante antes de decidir.',
  checklist:['Confira as regras do condomínio para unidade externa e horários.','Informe as características do equipamento sem abrir painéis elétricos.','Peça a descrição dos testes, materiais, garantia do serviço e itens cobrados à parte.']
 },
 {
  slug:'tecnico-de-geladeira', name:'Técnico de geladeira', category:'cat_geladeira', city:'Guarulhos', citySlug:'guarulhos',
  lead:'A geladeira não está refrigerando ou apresenta ruído em Guarulhos? Informe marca, modelo e os sintomas para combinar diagnóstico e orçamento antes de trocar peças.',
  heading:'Separe o diagnóstico da autorização para o conserto',
  items:['Marca, modelo e idade aproximada do equipamento.','Se o problema afeta refrigerador, freezer ou ambos.','Quando começou, códigos exibidos e reparos anteriores.'],
  scenarios:['Refrigeração insuficiente: relate o comportamento de cada compartimento sem atribuir a causa a uma peça.','Ruído: explique quando aparece e se é contínuo ou intermitente.','Vazamento de água: indique onde se acumula e com que frequência.'],
  example:'Busco técnico de geladeira em Guarulhos, bairro [bairro], para aparelho [marca/modelo]. Desde [quando], ocorre [sintoma] em [compartimento]. Já houve [reparo ou nenhum]. Quero saber preço da visita, diagnóstico e condições do orçamento antes do conserto.',
  compare:'Compare visita, diagnóstico, peças, mão de obra e retorno. Peça identificação das peças propostas, prazo e garantia por escrito.',
  question:'O valor da visita é descontado do conserto?', answer:'Depende da proposta. Confirme antes de agendar se a visita é cobrada mesmo sem aprovação do reparo e se existe abatimento quando o serviço é autorizado.',
  checklist:['Separe modelo e histórico de reparos para informar ao técnico.','Não abra componentes nem tente manusear a parte elétrica.','Autorize a troca de peças somente depois de receber diagnóstico, preço e condições do serviço.']
 }
];
const services={}, pages=[], editoriais={};
for (const x of entries) {
 services[x.slug]={name:x.name,category:x.category,items:x.items,compare:x.compare,question:'O Quem Faz realiza o serviço?',answer:'O Quem Faz conecta clientes a profissionais da região. Publicar o pedido é grátis, e a execução, o preço e o prazo são combinados diretamente com o profissional.'};
 pages.push([x.slug,x.citySlug,x.city]);
 editoriais[x.slug+'/'+x.citySlug]={...x,modified:'2026-10-20',example:x.example,question:x.question,answer:x.answer};
}
module.exports={services,pages,editoriais};
