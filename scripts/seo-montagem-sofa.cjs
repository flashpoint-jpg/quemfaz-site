// Conteúdo de apoio à contratação. Exemplos ilustrativos; sem preços, avaliações ou disponibilidade inventados.
const cities = [
 ['santo-andre','Santo André'], ['sao-bernardo-do-campo','São Bernardo do Campo'],
 ['maua','Mauá'], ['diadema','Diadema'], ['ribeirao-pires','Ribeirão Pires'], ['rio-grande-da-serra','Rio Grande da Serra']
];
const montagem = [
 { foco:'guarda-roupa novo', title:'Guarda-roupa novo: confira peças, espaço e acabamento',
   lead:'Comprou um guarda-roupa em Santo André? Informe marca, modelo, quantidade de portas e condições de acesso para pedir um orçamento de montagem completo.',
   tasks:['Informe se as portas são de abrir ou de correr, se há espelhos e quantas gavetas precisam ser montadas.','Diga se as caixas já chegaram e se há manual, lista de peças e ferragens.','Descreva o espaço livre no quarto e se existe rodapé, tomada ou obstáculo no local de instalação.'],
   pedido:'Preciso montar um guarda-roupa novo em Santo André, bairro [bairro], modelo [modelo], com [portas/gavetas]. As caixas estão [local] e tenho [manual/ferragens]. O acesso é por [escada/elevador]. Quero orçamento para montagem e regulagem de portas.',
   question:'Se faltar uma peça, a volta do montador está incluída?', answer:'Combine essa situação antes de agendar. Uma nova visita pode ser cobrada, dependendo do combinado. Confira as caixas e a lista de peças e avise ao profissional qualquer falta identificada.' },
 { foco:'painel e rack de TV', title:'Painel de TV e rack: separe montagem de fixação',
   lead:'Vai montar um painel ou rack de TV em São Bernardo do Campo? Informe modelo, medidas e tipo de parede para saber se o orçamento inclui a fixação e os materiais.',
   tasks:['Envie o modelo do painel e diga se o rack fica apoiado no piso ou suspenso.','Informe o tipo de parede, se souber, e se há passagem de cabos ou tomadas no local.','Diferencie montagem do móvel, instalação do suporte de TV e organização dos cabos: são tarefas que precisam ser combinadas.'],
   pedido:'Busco montador em São Bernardo do Campo, bairro [bairro], para painel [modelo/medidas] e rack [modelo]. A parede é [tipo ou não sei]. Preciso saber se fixação, buchas, suporte de TV e passagem de cabos entram na proposta.',
   question:'Montar o painel inclui instalar a televisão?', answer:'Não presuma que sim. Diga se a TV já tem suporte, informe modelo e peso conforme o fabricante e peça orçamento separado para o que será fixado. O profissional deve avaliar a parede e a compatibilidade dos materiais.' },
 { foco:'cama e cômoda', title:'Cama e cômoda: descreva cada móvel no mesmo pedido',
   lead:'Precisa montar cama, cômoda ou criado-mudo em Mauá? Liste os modelos e quantidades para comparar o preço do conjunto e planejar o espaço de montagem.',
   tasks:['Para a cama, informe tamanho, modelo e se inclui baú, gavetas ou cabeceira.','Para a cômoda, conte gavetas e portas e diga se alguma peça já veio montada.','Explique se precisa retirar ou desmontar um móvel antigo para liberar o cômodo.'],
   pedido:'Quero montar uma cama [tamanho/modelo] e uma cômoda [modelo] em Mauá, bairro [bairro]. Os móveis estão [novos/desmontados] e o quarto está [condição]. Gostaria de preço do conjunto, incluindo ajustes e retirada das embalagens, se oferecida.',
   question:'Desmontar o móvel antigo entra na montagem do novo?', answer:'Só se isso estiver na proposta. Liste a desmontagem como uma tarefa separada e confirme onde as peças antigas ficarão. Transporte e descarte também precisam ser combinados.' },
 { foco:'mesa e estação de trabalho', title:'Mesa de trabalho: informe acessórios e organização do espaço',
   lead:'Vai organizar seu espaço de trabalho em Diadema? Descreva mesa, gaveteiro e acessórios para combinar montagem, posicionamento e ajustes sem deixar tarefas de fora.',
   tasks:['Informe medidas e modelo da mesa e se há gaveteiro, prateleira ou regulagem de altura.','Diga se pretende instalar acessórios, como suporte de monitor, e se eles exigem furação.','Explique se o serviço será em residência ou sala comercial e quais horários de acesso estão disponíveis.'],
   pedido:'Preciso de montagem de mesa [modelo] e gaveteiro [modelo] em Diadema, bairro [bairro]. Quero incluir [acessórios]. O serviço será em [casa/sala comercial], com acesso em [horário]. Tenho manual e ferragens [sim/não].',
   question:'O montador faz os furos para acessórios da mesa?', answer:'Pergunte antes. Alguns acessórios usam presilhas e outros exigem furação. Informe o produto e confirme se o serviço é compatível com o móvel e com as orientações do fabricante.' },
 { foco:'desmontagem e remontagem para mudança', title:'Mudança: registre o estado do móvel antes da desmontagem',
   lead:'Vai mudar de imóvel em Ribeirão Pires e precisa desmontar e remontar móveis? Informe os dois locais, os modelos e o estado das peças para definir o serviço e as visitas.',
   tasks:['Liste quais móveis precisam ser desmontados e quais serão remontados no destino.','Informe se ambos os locais ficam na mesma cidade e quem fará o transporte das peças.','Avise sobre peças danificadas, furos alargados ou montagens anteriores para avaliação antes de fechar.'],
   pedido:'Preciso desmontar [móveis/modelos] e remontar após mudança em Ribeirão Pires, bairro [bairro]. A origem fica em [cidade/bairro] e o destino em [cidade/bairro]. O transporte será feito por [quem]. Quero combinar visitas, identificação das peças e ajustes.',
   question:'O preço de remontagem é igual ao de montagem de móvel novo?', answer:'Pode variar. O estado das peças, a identificação das ferragens e a necessidade de ajustes influenciam o trabalho. Peça avaliação e esclareça o que será feito se alguma peça não puder ser reaproveitada.' },
 { foco:'vários móveis em um pedido', title:'Vários móveis: monte uma lista para comparar propostas',
   lead:'Tem vários móveis para montar em Rio Grande da Serra? Reúna modelos, quantidades e prioridades para pedir uma proposta do conjunto e organizar a sequência do serviço.',
   tasks:['Faça uma lista por cômodo, separando itens novos, desmontados e móveis que só precisam de ajuste.','Informe se todas as entregas já chegaram ou se algum móvel ainda depende da loja.','Indique o que precisa ser montado primeiro e onde o profissional poderá abrir e organizar as peças.'],
   pedido:'Busco montador em Rio Grande da Serra, bairro [bairro], para [lista de móveis/modelos]. A prioridade é [móvel]. As entregas estão [situação]. Gostaria de preço do conjunto, previsão de visitas e condições para acrescentar algum item.',
   question:'Consigo acrescentar outro móvel no dia da montagem?', answer:'Confirme com o profissional. Um item adicional pode alterar preço e tempo de atendimento. Envie a lista completa antes para receber propostas comparáveis e evitar que uma tarefa fique para outra visita.' }
];
const sofa = {
 'santo-andre': {title:'Manchas no sofá: conte a origem e os produtos já usados', lead:'Derramou bebida ou apareceu uma mancha no sofá em Santo André? Informe quando aconteceu e o que já foi aplicado para conversar sobre o método e o resultado possível.',
 tasks:['Descreva a origem da mancha, se conhecida, e há quanto tempo está no tecido.','Informe produtos e tentativas anteriores, inclusive se a área ficou desbotada ou com marca.','Diga se a limpeza será do sofá inteiro ou se há interesse em tratar uma área específica.'],
 pedido:'Quero limpar um sofá de [lugares/modelo] em Santo André, bairro [bairro]. A mancha veio de [origem] há [tempo]. Já apliquei [produto ou nenhum]. O tecido é [tipo ou não sei]. Quero avaliação, preço total e previsão de secagem.',
 question:'O profissional pode prometer remover qualquer mancha?',answer:'O resultado depende do tecido, da substância e das tentativas de limpeza anteriores. Peça avaliação e explicação dos limites do tratamento antes de contratar; não presuma remoção completa.'},
 'maua': {title:'Odores e pelos de animais: detalhe o que precisa de tratamento', lead:'O sofá está com pelos ou odor de animal em Mauá? Explique quais peças foram afetadas para comparar limpeza, tratamento e orientações de secagem.',
 tasks:['Informe se o odor está no assento, encosto, almofadas soltas ou em mais de uma peça.','Diga se houve contato com urina ou outra substância e quando aconteceu.','Avise sobre animais que permanecem no ambiente e combine como liberar o espaço durante o serviço.'],
 pedido:'Preciso limpar um sofá de [lugares] em Mauá, bairro [bairro], com [pelos/odor] em [áreas]. O problema começou há [tempo] e já usei [produtos]. Quero saber o tratamento proposto, limites do resultado e quando poderei usar novamente.',
 question:'Eliminar odor está sempre incluído na limpeza?',answer:'Pergunte qual tratamento entra no valor e quais resultados podem ser esperados. O odor pode atingir camadas internas do estofado, e a avaliação define as possibilidades. Combine também os cuidados após a limpeza.'},
 'diadema': {title:'Sofá retrátil e reclinável: conte módulos, lugares e almofadas', lead:'Vai limpar um sofá retrátil ou reclinável em Diadema? Informe dimensões e configuração para comparar propostas sobre as mesmas partes do estofado.',
 tasks:['Diga quantos módulos e lugares existem e se os assentos abrem.','Informe almofadas removíveis e quais áreas deseja incluir, como laterais, encostos e braços.','Avise se há partes elétricas ou mecanismos que exigem cuidado segundo o fabricante.'],
 pedido:'Busco limpeza de sofá retrátil em Diadema, bairro [bairro], com [módulos/lugares], medidas [medidas]. Quero incluir [assentos/encostos/almofadas/laterais]. Há [manchas ou odores]. Preciso confirmar método, áreas incluídas e secagem.',
 question:'O preço por lugar inclui todas as partes do retrátil?',answer:'Isso varia conforme a proposta. Confirme como o profissional conta os lugares e quais partes serão limpas. Envie o modelo e as medidas para evitar comparar um preço parcial com outro do sofá completo.'},
 'ribeirao-pires': {title:'Sofá, cadeiras e poltronas: peça o orçamento por item', lead:'Quer limpar o sofá e outras peças em Ribeirão Pires? Liste cadeiras, poltronas ou colchões separadamente para saber o valor e os cuidados de cada estofado.',
 tasks:['Conte os lugares do sofá e a quantidade de cadeiras e poltronas.','Informe o tecido de cada peça, se souber, pois um método pode não servir para todos os materiais.','Explique se os móveis estão em cômodos diferentes ou se precisam ser deslocados para liberar o trabalho.'],
 pedido:'Quero orçamento em Ribeirão Pires, bairro [bairro], para sofá de [lugares], [quantidade] cadeiras e [quantidade] poltronas. Os tecidos são [tipos ou não sei]. Há [manchas/odor]. Peço valor por item e condições para realizar tudo no mesmo atendimento.',
 question:'Posso limpar peças de tecidos diferentes na mesma visita?',answer:'Informe todos os materiais antes de agendar. O profissional deve avaliar a técnica adequada para cada peça e esclarecer se consegue atender ao conjunto. Confirme preço, duração e cuidados de secagem de cada item.'},
 'rio-grande-da-serra': {title:'Planeje o uso do sofá depois da limpeza', lead:'Precisa limpar o sofá em Rio Grande da Serra antes de receber visitas ou mudar de imóvel? Informe a data e as condições do ambiente para combinar atendimento e secagem.',
 tasks:['Diga quando pretende voltar a usar o sofá e se existe outra opção de assento durante a secagem.','Descreva ventilação e espaço disponível, sem presumir que o estofado estará seco em um número fixo de horas.','Se houver mudança, informe a data do transporte e confirme se é adequado limpar antes ou depois.'],
 pedido:'Preciso limpar um sofá de [modelo/lugares] em Rio Grande da Serra, bairro [bairro]. Pretendo usar ou transportar em [data]. O ambiente tem [ventilação]. Há [manchas/odor]. Quero confirmar disponibilidade e uma previsão realista de secagem.',
 question:'Posso agendar a limpeza na véspera da mudança?',answer:'Apresente o cronograma ao profissional antes de confirmar. A secagem depende do tecido, do método e do ambiente. Combine uma margem de tempo e as condições para transportar o sofá sem embalar uma peça ainda úmida.'}
};
const services = {
 'montador-de-moveis': {name:'Montador de móveis',category:'cat_montador',lead:'Descreva os móveis e compare propostas de montagem.',items:['Marca, modelo, quantidade e dimensões dos móveis.','Se estão novos em caixas, desmontados ou precisam apenas de ajuste.','Local, acesso e horário permitido para o serviço.'],compare:'Separe montagem, desmontagem, fixação na parede, deslocamento e eventual retorno. Confirme ferramentas, ferragens, regulagem e o que será feito se faltar uma peça.',question:'A fixação na parede está incluída?',answer:'Confirme antes. Informe o móvel e o tipo de parede e peça que materiais e fixação sejam descritos na proposta, conforme as orientações do fabricante.'}
};
const pages=[], editoriais={};
for (let i=0;i<cities.length;i++) {
 const [slug,city]=cities[i], m=montagem[i];
 pages.push(['montador-de-moveis',slug,city]);
 editoriais['montador-de-moveis/'+slug]={lead:m.lead,heading:m.title,scenarios:m.tasks,example:m.pedido,
 checklist:['Tenha marca, modelo e manual disponíveis e avise se existem peças danificadas.','Confirme acesso ao imóvel, espaço para abrir as caixas e horário para uso de ferramentas.','Combine valor, tarefas incluídas e conferência de portas, gavetas e estabilidade ao terminar.'],question:m.question,answer:m.answer};
 if(sofa[slug]) {
  const x=sofa[slug];pages.push(['limpeza-de-sofa',slug,city]);
  editoriais['limpeza-de-sofa/'+slug]={lead:x.lead,heading:x.title,scenarios:x.tasks,example:x.pedido,
  checklist:['Informe a etiqueta do fabricante e o material, se souber, antes de escolher o método.','Confirme água, energia, espaço e ventilação necessários para o atendimento.','Combine deslocamento, peças incluídas e cuidados antes de voltar a usar o estofado.'],question:x.question,answer:x.answer};
 }
}
const hub={slug:'montador-de-moveis',cat:'cat_montador',nome:'Montador de móveis',curto:'montador de móveis',duplicados:[],
 lead:'Guarda-roupa, cama, rack ou móveis para uma mudança? Informe marca, modelo e cidade para comparar propostas de montagem no ABC.',
 quando:['Móvel novo em caixas, com manual e ferragens','Remontagem de móvel usado após mudança','Montagem de painel, rack, cama ou mesa','Ajustes de portas e gavetas a combinar com o profissional'],
 informar:['Lista de móveis, marca, modelo e quantidade','Estado das peças e se já houve montagens anteriores','Tipo de acesso e regras de horário do imóvel','Necessidade de desmontagem, fixação ou visitas em dois endereços'],
 comparar:'Peça o escopo por escrito: montagem, ajustes, fixação, ferragens e possível retorno. Transporte e descarte de móveis ou embalagens devem ser combinados separadamente.',
 cuidados:['Informe peças quebradas ou ausentes antes da visita.','Combine espaço livre para montar e testar portas e gavetas.','A fixação deve seguir a orientação do fabricante e depende da avaliação da parede.'],
 faq:[['O montador transporta os móveis?','Não presuma que o transporte esteja incluído. Combine quem fará a retirada, o deslocamento e a entrega das peças.'],['Posso pedir montagem de vários móveis juntos?','Sim. Liste todos os modelos e quantidades para receber propostas do conjunto e combinar a ordem das tarefas.']]};
module.exports={services,pages,editoriais,hub};
