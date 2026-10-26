// Referências geográficas, sem inferir preço, oferta ou tempo de deslocamento.
// Fontes e critérios editoriais: docs/seo-canibalizacao.md.
module.exports = {
  'santo-andre': {
    name: 'Santo André', areas: ['Centro', 'Campestre', 'Utinga'],
    lead: 'Em Santo André, identifique o bairro antes de combinar uma visita: Centro, Campestre e Utinga são referências diferentes para localizar o atendimento. Acrescente o acesso ao imóvel e uma janela de horário em que alguém possa receber o profissional.',
    detail: 'Se o endereço fica próximo à divisa com São Bernardo ou São Caetano, mantenha Santo André como município e use o bairro e o CEP para esclarecer o ponto de atendimento. Não substitua a cidade pelo nome da região do ABC.',
    question: 'Moro em Utinga: devo preencher Santo André ou apenas ABC?',
    answer: 'Preencha Santo André como cidade e Utinga como bairro. ABC é uma referência regional, não o município do endereço. Use o CEP para conferir os dados antes de publicar.'
  },
  'sao-bernardo-do-campo': {
    name: 'São Bernardo do Campo', areas: ['Rudge Ramos', 'Baeta Neves', 'Assunção'],
    lead: 'Para um atendimento em São Bernardo do Campo, diferencie endereços de Rudge Ramos, Baeta Neves e Assunção no pedido. Se a visita for em condomínio, confirme entrada de prestadores e recebimento de equipamentos antes de fechar a data.',
    detail: 'Não use apenas “São Bernardo” como referência de acesso: registre o município completo e o bairro. Se houver portaria, descreva o procedimento de liberação e avise sobre elevador ou distância entre a entrada e o local do trabalho.',
    question: 'Um pedido em Rudge Ramos pode usar a localização de Santo André?',
    answer: 'Use a cidade do endereço, São Bernardo do Campo, e informe Rudge Ramos no bairro. Mesmo perto de uma divisa, mudar o município pode direcionar o pedido para uma localização incorreta.'
  },
  maua: {
    name: 'Mauá', areas: ['Jardim Zaíra', 'Parque São Vicente', 'Vila Bocaina'],
    lead: 'Em Mauá, escreva o bairro pelo nome usado no endereço, como Jardim Zaíra, Parque São Vicente ou Vila Bocaina. Informe também se há escadas ou restrições para levar equipamentos até o ponto do serviço.',
    detail: 'As regiões de planejamento de Mauá não substituem a referência do seu endereço. Se você conhece a região como RP, acrescente o nome do bairro e o CEP para que o prestador possa avaliar a visita sem depender dessa sigla.',
    question: 'Posso informar só a região de planejamento de Mauá?',
    answer: 'Prefira o nome do bairro e o CEP. Jardim Zaíra e Parque São Vicente, por exemplo, identificam melhor o endereço do que uma sigla de região de planejamento isolada.'
  },
  diadema: {
    name: 'Diadema', areas: ['Piraporinha', 'Eldorado', 'Serraria'],
    lead: 'Piraporinha, Eldorado e Serraria devem aparecer como bairro quando o serviço é em Diadema. Ao agendar, explique por onde o profissional entra e em quais horários o espaço estará disponível para trabalhar.',
    detail: 'Para um imóvel na divisa com outro município, confira a cidade pelo CEP antes de enviar. Na descrição, separe o horário em que você estará no local do horário em que o condomínio ou estabelecimento permite o serviço.',
    question: 'Como localizar um atendimento em Eldorado, Diadema?',
    answer: 'Informe Diadema como município, Eldorado como bairro e confira o CEP. Acrescente uma orientação de acesso ao combinar a visita; o nome Eldorado sozinho pode existir em outras cidades.'
  },
  'ribeirao-pires': {
    name: 'Ribeirão Pires', areas: ['Centro', 'Suíssa', 'Centro Ouro Fino Paulista'],
    lead: 'Em Ribeirão Pires, indique se o endereço está no Centro, em Suíssa ou na região de Ouro Fino Paulista. Para avaliar a visita, descreva o acesso e a possibilidade de aproximar veículo e equipamentos do imóvel.',
    detail: 'Ouro Fino Paulista deve complementar a localização dentro de Ribeirão Pires. Em entradas compartilhadas ou terrenos com mais de uma construção, explique qual unidade receberá o atendimento e quem fará a liberação.',
    question: 'Como preencher um endereço em Ouro Fino Paulista?',
    answer: 'Mantenha Ribeirão Pires como município e informe a referência de Ouro Fino Paulista no bairro, conforme o endereço e o CEP. Confirme o ponto exato com o profissional antes de agendar.'
  },
  'rio-grande-da-serra': {
    name: 'Rio Grande da Serra', areas: ['Centro', 'Vila Niwa', 'Jardim Santa Tereza'],
    lead: 'Para Rio Grande da Serra, referências como Centro, Vila Niwa e Jardim Santa Tereza ajudam a identificar o local. Descreva a entrada da propriedade e eventuais limitações de acesso para materiais ou ferramentas.',
    detail: 'Não confunda Rio Grande da Serra com Ribeirão Pires ao preencher o município. Se a rua tiver mais de uma entrada ou o local não for fácil de identificar, combine uma referência de acesso antes da visita.',
    question: 'Posso publicar usando Ribeirão Pires para um imóvel em Vila Niwa?',
    answer: 'Se o endereço é em Vila Niwa, Rio Grande da Serra, use esse município. A proximidade entre cidades não justifica mudar a localização do pedido; confira o CEP em caso de dúvida.'
  },
  guarulhos: {
    name: 'Guarulhos', areas: ['Bom Clima', 'Bonsucesso', 'Cabuçu'],
    lead: 'Em Guarulhos, diferencie Bom Clima, Bonsucesso e Cabuçu ao explicar onde será a visita. O bairro e o CEP ajudam a evitar uma proposta baseada somente no nome da cidade.',
    detail: 'Se o trabalho ocorrer em uma empresa, informe se o prestador precisa de cadastro, documento de acesso ou acompanhamento interno. Para residências, combine quem receberá a equipe e o local para descarregar equipamentos.',
    question: 'Preciso escrever Guarulhos se o endereço fica perto da capital?',
    answer: 'Sim, quando esse é o município do endereço. Use Guarulhos e o bairro correspondente, como Bom Clima ou Bonsucesso, em vez de cadastrar o local genericamente como São Paulo.'
  },
  'sao-paulo': {
    name: 'São Paulo', areas: ['Pinheiros', 'Santana', 'Vila Mariana'],
    lead: 'Na capital, dizer apenas “São Paulo” deixa o local pouco definido. Informe o bairro ou distrito, como Pinheiros, Santana ou Vila Mariana, e o CEP para permitir a avaliação do deslocamento.',
    detail: 'Zona Norte, Sul, Leste e Oeste são referências amplas. Acrescente o bairro do endereço e esclareça regras de entrada ou estacionamento ao combinar a visita, sem publicar dados de acesso sensíveis na descrição.',
    question: 'Basta informar Zona Sul para um atendimento na capital?',
    answer: 'Não é uma referência suficiente para localizar o imóvel. Preencha São Paulo como município, indique seu bairro ou distrito e confira o CEP antes de combinar o deslocamento.'
  },
  suzano: {
    name: 'Suzano', areas: ['Centro', 'Palmeiras', 'Dona Benta'],
    lead: 'Para contratar em Suzano, esclareça se o imóvel fica no Centro, em Palmeiras ou na região de Dona Benta. Use o bairro completo e a data pretendida para que a proposta considere o local correto.',
    detail: 'Alto Tietê é uma referência regional e não deve substituir Suzano no campo cidade. Quando o endereço for conhecido por um nome de região, acrescente o bairro do CEP e uma orientação de chegada ao agendar.',
    question: 'Como descrever um serviço na região de Palmeiras, em Suzano?',
    answer: 'Informe Suzano como cidade e detalhe o bairro do imóvel na região de Palmeiras. Confira o CEP e esclareça a entrada do local antes de confirmar a visita.'
  },
  bauru: {
    name: 'Bauru', areas: ['Centro', 'Vila Falcão', 'Jardim Bela Vista'],
    lead: 'Centro, Vila Falcão e Jardim Bela Vista são referências para localizar seu pedido em Bauru. Ao descrever o endereço, indique o bairro que consta no CEP e não apenas uma região ampla da cidade.',
    detail: 'Se o seu ponto de referência é uma avenida ou um estabelecimento, use-o para complementar o bairro, sem substituir os dados do endereço. Combine acesso, horário e condições para levar os equipamentos até o espaço de trabalho.',
    question: 'Posso usar só uma avenida de referência em Bauru?',
    answer: 'Use a avenida apenas como complemento. Informe Bauru, o bairro do imóvel e o CEP; uma referência entre Vila Falcão e Jardim Bela Vista, por exemplo, não dispensa conferir o endereço.'
  },
  'ribeirao-preto': {
    name: 'Ribeirão Preto', areas: ['Centro', 'Campos Elíseos', 'Ipiranga'],
    lead: 'Em Ribeirão Preto, identifique o bairro do imóvel, por exemplo Centro, Campos Elíseos ou Ipiranga. Diga quais espaços precisam estar liberados e em que dia você deseja receber a visita.',
    detail: 'Não confunda Ribeirão Preto, no interior, com Ribeirão Pires, no ABC. Confira o município e o CEP no pedido; para um endereço comercial, combine também horário de acesso e quem autoriza o início do trabalho.',
    question: 'Ribeirão Preto e Ribeirão Pires podem usar a mesma localização?',
    answer: 'Não. São municípios diferentes. Para atendimento em Campos Elíseos ou Ipiranga, em Ribeirão Preto, mantenha Ribeirão Preto no campo cidade e confira o CEP do imóvel.'
  }
};
