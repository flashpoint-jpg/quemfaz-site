// Escopos editoriais: o nome da categoria do aplicativo permanece intacto.
const intents = {
  'azulejista-pisos': {
    name: 'Azulejista/Pisos', focus: 'assentamento e troca de revestimentos', primary: 'pedreiro',
    lead: 'Assentamento de piso, azulejo e porcelanato, troca de peças e recuperação de rejunte exigem medidas e preparação da base. Descreva a superfície que deseja revestir.',
    tasks: ['Metragem e dimensões das peças de piso ou azulejo.', 'Estado do contrapiso, recortes e necessidade de retirar revestimento antigo.', 'Tipo de porcelanato, paginação, rodapés e acabamento do rejunte.'],
    question: 'O orçamento inclui regularização da base e rejunte?', answer: 'Peça esses itens separados: preparo da base, assentamento, recortes, rejunte e retirada de resíduos. Confirme quem compra argamassa e peças de reposição.'
  },
  pedreiro: {
    name: 'Pedreiro', focus: 'alvenaria, muros e reparos de paredes', primary: 'pedreiro',
    lead: 'Construir um muro, levantar uma divisória de alvenaria ou recuperar o reboco são trabalhos de pedreiro. Informe dimensões, condição da estrutura e acesso para materiais.',
    tasks: ['Comprimento e altura de muros ou paredes de alvenaria.', 'Trechos de reboco solto, abertura de vãos e reparos de argamassa.', 'Acesso para entrega de blocos, cimento e retirada de entulho.'],
    question: 'Posso pedir uma avaliação antes de alterar uma parede?', answer: 'Sim. Informe o que deseja modificar e peça avaliação antes de começar. Intervenções que afetem a estrutura podem exigir responsável técnico; não autorize demolição sem esclarecer essa condição.'
  },
  gesseiro: {
    name: 'Gesseiro', focus: 'forros, sancas e divisórias de gesso', primary: 'pedreiro',
    lead: 'Forro rebaixado, sanca, moldura ou divisória de drywall: o pedido de gesso deve indicar altura, dimensões e acabamento pretendido.',
    tasks: ['Área do teto, altura livre e desenho da sanca.', 'Quantidade de divisórias, portas e reforços necessários no drywall.', 'Pontos de inspeção, tratamento de juntas e acabamento para pintura.'],
    question: 'A proposta do gesseiro inclui pintura?', answer: 'Não presuma que inclui. Separe estrutura, chapas ou placas, tratamento de juntas, acabamento e pintura ao comparar propostas.'
  },
  eletricista: {
    name: 'Eletricista', focus: 'fiação, tomadas e disjuntores', primary: 'eletricista',
    lead: 'Tomada aquecendo, disjuntor desarmando ou circuito sem energia? Procure diagnóstico e reparo da instalação elétrica, indicando os pontos afetados e os aparelhos ligados.',
    tasks: ['Sintomas na fiação, no quadro de distribuição ou nas tomadas.', 'Quantidade de circuitos, luminárias e interruptores para instalar.', 'Potência dos equipamentos e necessidade de revisão da instalação.'],
    question: 'Como comparar uma revisão elétrica?', answer: 'Solicite separação entre diagnóstico, materiais, mão de obra e testes. Em caso de faísca ou cheiro de queimado, interrompa o uso do ponto e procure avaliação.'
  },
  'automacao-residencial': {
    name: 'Automação residencial', focus: 'casa inteligente e integração de dispositivos', primary: 'eletricista',
    lead: 'Controle de iluminação, cortinas e rotinas por aplicativo ou voz: automação residencial trata da integração de dispositivos de uma casa inteligente.',
    tasks: ['Dispositivos, marcas e assistentes de voz que já utiliza.', 'Rotinas desejadas, como acender luzes ou programar cortinas.', 'Compatibilidade do hub, conectividade e configuração dos aplicativos.'],
    question: 'Preciso trocar todos os equipamentos para automatizar a casa?', answer: 'Depende da compatibilidade. Liste os modelos atuais e peça uma proposta de integração, configuração e orientação de uso antes de comprar novos dispositivos.'
  },
  'instalador-de-cameras-cftv-e-alarmes': {
    name: 'Instalador de câmeras (CFTV) e alarmes', focus: 'videomonitoramento e sensores de segurança', primary: 'eletricista',
    lead: 'Câmeras de segurança, gravador DVR ou NVR e alarmes precisam de posicionamento, cabeamento e configuração de acesso. Informe as áreas que deseja monitorar.',
    tasks: ['Quantidade de câmeras, áreas internas ou externas e pontos cegos.', 'Modelos do gravador, armazenamento e tempo de gravação desejado.', 'Sensores, sirene e acesso às imagens pelo celular.'],
    question: 'O instalador configura o acesso remoto às câmeras?', answer: 'Confirme se configuração, testes de gravação e orientação sobre senhas estão incluídos. Combine quem terá acesso às imagens e como serão entregues as credenciais.'
  },
  jardineiro: {
    name: 'Jardineiro', focus: 'manutenção de jardins e corte de grama', primary: 'jardineiro',
    lead: 'Cortar a grama, cuidar de canteiros e manter plantas são tarefas de conservação do jardim. Informe a área e a frequência de manutenção pretendida.',
    tasks: ['Metragem do gramado e estado dos canteiros.', 'Capina, adubação e cuidados de plantas de pequeno porte.', 'Frequência das visitas e retirada dos resíduos verdes.'],
    question: 'Posso combinar manutenção periódica do jardim?', answer: 'Sim. Peça uma lista de tarefas por visita, frequência, materiais e destino dos resíduos. Confirme separadamente serviços que exigem equipamento ou equipe adicional.'
  },
  'poda-de-arvores-paisagista': {
    name: 'Poda de árvores/Paisagista', focus: 'manejo arbóreo e projeto paisagístico', primary: 'jardineiro',
    lead: 'Poda de árvores de maior porte e planejamento paisagístico pedem avaliação específica. Indique se precisa de manejo de uma árvore ou de um projeto para reorganizar a área verde.',
    tasks: ['Altura aproximada, fotos da árvore e obstáculos ao redor.', 'Objetivo do projeto, medidas do espaço e espécies desejadas.', 'Avaliação de autorizações, equipamentos e destinação dos galhos.'],
    question: 'Posso autorizar qualquer poda por conta própria?', answer: 'Antes de executar, consulte as exigências da prefeitura e a situação da árvore. Informe se ela está em terreno particular ou área pública; não presuma que a contratação substitui uma autorização.'
  },
  diarista: {
    name: 'Diarista', focus: 'faxina de rotina da casa', primary: 'diarista',
    lead: 'Para a limpeza cotidiana de uma casa em uso, organize os cômodos, a frequência e as tarefas da diária. O foco é a manutenção da higiene doméstica.',
    tasks: ['Quantidade de quartos, banheiros e áreas de uso diário.', 'Tarefas de rotina, como tirar pó, limpar banheiro e cozinha.', 'Duração da diária, produtos disponíveis e frequência desejada.'],
    question: 'O que combinar para uma diária de limpeza?', answer: 'Defina prioridades, horário, produtos e valor total. Confirme o que cabe na diária para evitar tarefas adicionais sem acordo prévio.'
  },
  'faxina-pos-obra': {
    name: 'Faxina pós-obra', focus: 'remoção de poeira e resíduos de reforma', primary: 'diarista',
    lead: 'Depois da reforma, poeira fina, respingos de tinta e resíduos exigem uma limpeza técnica de entrega. Informe o estágio da obra e as superfícies que precisam de cuidado.',
    tasks: ['Metragem, ambientes e data em que a reforma estará encerrada.', 'Poeira fina, respingos e resíduos aderidos nas superfícies.', 'Materiais delicados, proteção de acabamentos e descarte combinado.'],
    question: 'A limpeza inclui retirada de entulho pesado?', answer: 'Não presuma que inclui. Diferencie remoção de resíduos leves, limpeza de acabamento e transporte de entulho. Peça uma proposta com essas etapas discriminadas.'
  },
  passadeira: {
    name: 'Passadeira', focus: 'roupas passadas e organizadas', primary: 'diarista',
    lead: 'Camisas, peças sociais e roupa de cama acumuladas pedem um atendimento dedicado a passar roupas. Descreva a quantidade e os tecidos, sem misturar a tarefa com faxina.',
    tasks: ['Quantidade de peças e tipos de tecido.', 'Peças delicadas, camisas e roupa de cama separadas por prioridade.', 'Ferro, tábua e cabides disponíveis no local.'],
    question: 'A passadeira cobra por peça ou por período?', answer: 'Há diferentes formas de cobrança. Peça o critério, a quantidade estimada de peças e o tempo de trabalho antes de agendar.'
  },
  'frete-carreto': {
    name: 'Frete/Carreto', focus: 'transporte de itens e pequenas cargas', primary: 'frete-carreto',
    lead: 'Levar um móvel comprado, retirar um eletrodoméstico ou transportar poucas caixas é um pedido de frete ou carreto. Liste os itens e os pontos de coleta e entrega.',
    tasks: ['Quantidade, medidas e peso aproximado dos objetos.', 'Origem, destino e distância entre os dois endereços.', 'Escadas, elevador e necessidade de ajudante para carga e descarga.'],
    question: 'O carreto inclui ajudante?', answer: 'Confirme antes de contratar. Transporte, embalagem, ajudante e montagem são itens diferentes e devem constar na proposta quando necessários.'
  },
  mudancas: {
    name: 'Mudanças', focus: 'transferência completa de residência ou escritório', primary: 'frete-carreto',
    lead: 'A transferência de uma casa ou escritório envolve inventário, embalagem e planejamento da carga. Relacione todos os ambientes e o prazo para desocupar o imóvel.',
    tasks: ['Inventário por cômodo, móveis grandes e número de caixas.', 'Embalagem, desmontagem e remontagem que devem entrar no contrato.', 'Agenda de saída e chegada, equipe e condições de proteção dos bens.'],
    question: 'Como comparar duas propostas de mudança?', answer: 'Use o mesmo inventário e confira equipe, embalagem, desmontagem, transporte, condições de responsabilidade e serviços extras. Combine vistoria quando o volume não estiver claro.'
  },
  'tecnico-em-informatica': {
    name: 'Técnico em informática', focus: 'conserto de computadores e notebooks', primary: 'tecnico-em-informatica',
    lead: 'Computador lento, notebook sem ligar ou falha no sistema operacional? O suporte de informática avalia o equipamento, componentes, programas e preservação dos arquivos.',
    tasks: ['Marca, modelo e sintomas do computador ou notebook.', 'Mensagens de erro, lentidão e peças que já foram trocadas.', 'Necessidade de backup e autorização antes de reinstalar o sistema.'],
    question: 'A formatação apaga meus arquivos?', answer: 'Pode apagar. Combine backup e autorização antes de reinstalar o sistema ou substituir a unidade de armazenamento. Peça diagnóstico antes de decidir pela formatação.'
  },
  'tecnico-de-internet-e-redes': {
    name: 'Técnico de internet e redes', focus: 'Wi-Fi, roteadores e cabeamento de rede', primary: 'tecnico-em-informatica',
    lead: 'Wi-Fi fraco, pontos sem conexão e cabeamento desorganizado pedem diagnóstico da rede. Informe o roteador, a planta do local e os ambientes sem sinal.',
    tasks: ['Operadora, plano contratado e modelo do roteador.', 'Ambientes sem cobertura e quantidade de dispositivos conectados.', 'Pontos de rede, cabeamento e necessidade de configurar uma rede mesh.'],
    question: 'Como diferenciar falha da operadora e problema no Wi-Fi?', answer: 'Informe se a conexão também falha por cabo e quais luzes ou mensagens aparecem no equipamento. O técnico pode testar a rede interna; falhas do fornecimento devem ser tratadas com a operadora.'
  },
  mecanico: {
    name: 'Mecânico', focus: 'motor, freios e suspensão', primary: 'mecanico',
    lead: 'Ruído no motor, desgaste de freios ou problema de suspensão exigem avaliação mecânica. Descreva o sintoma, o veículo e as condições em que a falha aparece.',
    tasks: ['Marca, modelo, ano, motorização e quilometragem.', 'Ruídos, vazamentos e comportamento ao frear ou rodar.', 'Histórico de manutenção e local em que o veículo está.'],
    question: 'Posso aprovar peças somente depois do diagnóstico?', answer: 'Combine avaliação, orçamento e autorização antes da troca. Peça identificação das peças, mão de obra e condições de garantia do reparo.'
  },
  autoeletrico: {
    name: 'Autoelétrico', focus: 'alternador, motor de partida e circuitos do veículo', primary: 'mecanico',
    lead: 'Falhas no alternador, motor de partida, faróis ou circuitos do carro pedem diagnóstico autoelétrico. Relate luzes no painel e quando a falha acontece.',
    tasks: ['Modelo e ano do veículo e comportamento ao dar a partida.', 'Luzes do painel, falhas na iluminação ou acessórios sem funcionar.', 'Testes do sistema de carga, aterramento e fuga de corrente.'],
    question: 'Trocar a bateria resolve falha no alternador?', answer: 'Não necessariamente. Peça teste do sistema de carga e do circuito antes de substituir componentes. Uma falha no alternador pode exigir um reparo diferente.'
  },
  'bateria-automotiva': {
    name: 'Bateria automotiva', focus: 'teste, troca e compatibilidade da bateria', primary: 'mecanico',
    lead: 'Precisa testar ou substituir a bateria do carro? Informe modelo, ano e especificação atual para comparar capacidade, instalação e garantia.',
    tasks: ['Modelo, ano e tecnologia exigida pelo veículo, inclusive start-stop.', 'Capacidade da bateria atual e resultado de testes, se houver.', 'Local do veículo, instalação, garantia e destino da bateria usada.'],
    question: 'Qual bateria é compatível com meu veículo?', answer: 'Confirme especificação, dimensões, polaridade e tecnologia com base no manual e na avaliação. Não escolha somente pelo preço ou pela amperagem anunciada.'
  },
  'limpeza-de-sofa': {
    name: 'Limpeza de sofá', focus: 'manchas, odores e cuidado do sofá', primary: 'limpeza-de-sofa',
    lead: 'O sofá tem manchas, odor ou sujeira nas partes retráteis? Informe tecido, módulos e tempo de uso para avaliar a limpeza sem comprometer o material.',
    tasks: ['Número de lugares, módulos e mecanismo retrátil ou reclinável.', 'Origem das manchas e produtos já aplicados no sofá.', 'Etiqueta do fabricante e ventilação para secagem.'],
    question: 'Quando posso usar o sofá depois da limpeza?', answer: 'A secagem varia conforme o tecido, o método e a ventilação. Confirme a previsão e os cuidados antes de agendar; não há prazo único para todos os sofás.'
  },
  'limpeza-de-estofados-e-tapetes': {
    name: 'Limpeza de estofados e tapetes', focus: 'cadeiras, poltronas, colchões e tapetes', primary: 'limpeza-de-sofa',
    lead: 'Para limpar cadeiras estofadas, poltronas, colchões e tapetes, relacione cada peça e seu material. Compare o preço por item e o método indicado para cada tecido.',
    tasks: ['Quantidade de cadeiras, poltronas e colchões.', 'Medidas, composição e etiquetas dos tapetes.', 'Limpeza no local ou retirada e prazo de devolução.'],
    question: 'A limpeza dos tapetes pode ser feita no local?', answer: 'Depende do material e do método. Confirme se há retirada, como será a secagem e o prazo de devolução, discriminando cada peça na proposta.'
  }
};

// Variações de busca mantêm escopos próprios; a categoria usada no pedido não muda.
const aliases = {
  'higienizacao-de-sofa': ['limpeza-de-sofa', 'higienização e cuidados com odores', 'Informe a origem do odor, o tecido e os produtos já aplicados. Peça explicação do método e de suas limitações, sem presumir eliminação completa de agentes ou manchas.'],
  'limpeza-de-estofado': ['limpeza-de-estofados-e-tapetes', 'avaliação de peças estofadas', 'Liste cadeiras, poltronas e cabeceiras por material e quantidade. Peça avaliação individual para tecidos delicados e confirme proteção, secagem e preço de cada peça.'],
  faxineira: ['diarista', 'faxina avulsa por ambiente', 'Para uma visita pontual, escolha os ambientes prioritários e descreva o estado de cada um. Combine o que será entregue nessa visita, sem pressupor contratação recorrente.'],
  'limpeza-pos-obra': ['faxina-pos-obra', 'planejamento da limpeza de entrega', 'Organize a limpeza após a saída da equipe de reforma. Informe a data de liberação, os ambientes prontos e a sequência necessária antes de receber móveis.'],
  'tecnico-em-automacao': ['automacao-residencial', 'diagnóstico de dispositivos inteligentes', 'Relate rotinas que pararam de funcionar, mensagens do aplicativo e modelos dos dispositivos. Peça teste de compatibilidade antes de substituir equipamentos.']
};
module.exports = { intents, aliases };
