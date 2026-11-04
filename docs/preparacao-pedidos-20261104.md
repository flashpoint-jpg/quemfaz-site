# Preparação — pedidos publicados — 04/11/2026

Nada aplicado ao Google Ads, publicado no site ou mergeado. Não aplicar sem conferência do proprietário.

## Google Ads: leitura da conta 734-351-8086
Campanha 24417863673: QF | CLIENTES | REFORMAS E REPAROS | NOV26, ENABLED.

| Grupo | Anúncio atual | Estado | Destino preservado |
|---|---|---|---|
| Eletricista | 830376969089 | ENABLED | https://quemfazservico.com.br/ |
| Pedreiro | 830246432352 | ENABLED | https://quemfazservico.com.br/ |
| Pintor | 830376961163 | ENABLED | https://quemfazservico.com.br/ |
| Encanador | 830293022098 | ENABLED | https://quemfazservico.com.br/ |
| Gesseiro | 830246436441 | ENABLED | https://quemfazservico.com.br/ |
| Azulejista e Pisos | 830376937571 | ENABLED | https://quemfazservico.com.br/ |

Antes: os seis anúncios incluem “Sem Cadastro Obrigatório”, “Peça em 1 Minuto”, “Compare Orçamentos” e “Até 4 Podem Chamar no WhatsApp”.
Descrições atuais comuns aos seis:
1. Conte o serviço que precisa e receba propostas de profissionais da sua região. É grátis.
2. Peça em 1 minuto, sem cadastro. Compare orçamentos e escolha o profissional que preferir.
3. Até 4 profissionais podem te chamar no WhatsApp. Você decide com quem fechar o serviço.
4. Reformas e reparos: publique seu pedido grátis e compare propostas de profissionais.

Depois proposto: conjunto solicitado abaixo. Somente texto para revisão/cópia; nenhum anúncio editado. Ao distribuir por grupo, manter títulos da profissão correspondente; conjunto não aprovado para aplicação automática em Encanador (não há título específico de encanador fornecido).

### Títulos de rascunho (caracteres)
- Pedreiro Perto de Você (22)
- Azulejista Perto de Você (24)
- Gesseiro Perto de Você (22)
- Pintor Profissional na Região (29)
- Eletricista na Sua Região (25)
- Precisa de Pedreiro Urgente? (28)
- Serviços de Pedreiro e Reforma (30)
- Peça Orçamento Grátis (21)
- Publique Seu Pedido Grátis (26)
- Pedido Grátis, Sem Compromisso (30)
- Até 4 Profissionais da Região (29)
- Você Compara e Escolhe (22)

### Descrições de rascunho (caracteres)
1. Publique o pedido grátis, compare e escolha com quem fechar. Sem pagar nada para pedir. (87)
2. Conte o que precisa e receba contato de profissionais da sua região. Sem compromisso. (85)
3. Pedreiro, azulejista, gesseiro, pintor e eletricista perto de você. Peça pelo site. (83)
4. Até 4 profissionais da sua região podem entrar em contato com você. Pedir é grátis. (83)

### Negativas preventivas em frase — NÃO APLICADAS
"vaga", "vagas", "emprego", "empregos", "curso", "apostila", "tutorial", "senai", "cbo", "como ser", "aprender", "salário", "piso salarial", "trabalhe conosco", "industrial", "automotivo", "automóveis", "autos".

Nunca negativar: perto de mim, urgente, valor, preço, orçamento, contratar, profissional, serviços. Os nove termos anteriormente recebidos não foram negativados.

### Conversão
Ação “Pedido publicado” 7662297511, ENABLED, WEBPAGE. Na campanha em 04/11, a consulta retornou 1 conversão, 1 em todas as conversões, e 1 pela data da conversão.
Isso NÃO permite identificar o chamado 910df5e5-20c3-4962-ae7b-3422524d4f5d: os relatórios consultados são agregados, sem transaction_id. Não foi possível confirmar individualmente o pedido de Guarulhos às 11h27 nem concluir que não contou.
O código da main envia transaction_id com o ID e o destino AW-18273159663/RIX-CKfD1cUcEO-TqYlE, coincidente com a ação. Há bloqueio quando consentimento de medição não é granted. Isso é uma condição do código, NÃO causa comprovada para esse pedido. Nenhuma tag alterada. Pendente cruzamento individual com dados de origem/consentimento do pedido; não atribuir o total a esse chamado sem evidência.

## Formulário: antes e depois
Antes: checkbox informativo aceite_app era etapa obrigatória; payload copiava a resposta e publish bloqueava sem sim.
Depois: questions omite a etapa quando requiresInstalledApp() é false; payload envia sim nesse modo; publish normaliza o campo antes da verificação. Consentimento autorizacao e celular continuam obrigatórios. Nenhuma migração ou alteração de servidor. Home/SEO com serviço e descrição preenchidos pulam a etapa vazia, inclusive ao voltar. Os dois testes de SEO integrado passaram, incluindo publicação em PostgreSQL isolado.
Testes atualizados apenas onde havia expectativa/clique no checkbox; teste específico cobre ausência do campo, payload sim, recusa de autorização e telefone inválido.

Registro do texto livre no erro service NÃO implementado: depende de aprovação específica. Não adicionado dado pessoal ao funil.

## Validação e limitações
npm ci executado. Base anterior: 548 testes, 517 passaram, 29 falharam. Lista das falhas abaixo. Três testes direcionados após mudança passaram (navegador, funil e restauração OAuth).
Teste visual a 390px e publicação com espera de 60 segundos NÃO concluídos: Chromium ausente, instalação Playwright falhou no download. Nenhum pedido de teste criado em produção, portanto nenhum ID a entregar. Essa validação fica pendente antes de aprovar/publicar; testes locais não equivalem a publicação real.

### Falhas anteriores

- Publicação real permanece na index e guarda acompanhamento sem expor código
- Admin: cortesia com prazo customizado e mensagens prontas só registram após confirmação
- cadastro: excluir da lista não remove a conta nem executa cobrança
- atendimento: adapta perguntas e valida todas antes da publicação
- diarista: serviço escolhido na home não repete e respostas são aceitas pelo banco
- quatro etapas: pedido sem orçamento ou data obrigatórios e materiais pertinentes
- bairro continua obrigatório e preenchido com cidade/UF vindas da home
- Painel administrativo carrega com sintaxe válida e conexão realmente existente
- Administrativo permite localizar nome, contato, plano e estágio de pagamento sem confundir com cadastro ativo
- Saldo das carteiras é exclusivo de Movimentações e ausente da ficha de cadastro
- o signup passa o comprovante ao banco e exige confirmação novamente antes da conta
- Quatro planos novos pagos, com preços exatos
- Oferta nova não apresenta comissão ao profissional, sem apagar histórico antigo
- admin exige evidência e controle financeiro não abre Pix automático
- formulário atual publica no PostgreSQL local e apresenta o pedido salvo na própria página
- cliente pode informar outro local manualmente, sem precisar de GPS
- orçamento define modalidade, inclusive faixa até 500 e materiais a combinar
- tests/home-contador.test.cjs
- Novos planos exibem cotas, valores e não prometem comissão nem repasse universal
- Exibir oferta não cria cobrança automaticamente
- tela exige consentimento e mostra preço antes de gerar Pix; abertura não cobra
- administrativo permite pausa na gestão manual e não exige conta Meta
- tests/pagamento-antes-da-conta.test.cjs
- tests/painel-menu-lateral.test.cjs
- CEP não obriga usuário a informar rua ou número e continua privado no payload
- sem Pix não finaliza cadastro: mostra mensagem de pagamento obrigatório
- Livre: ativo, vencido e contratação sem ativação pelo cliente
- cliente escolhe sim ou não para orçamento presencial R$25 na etapa de condições
- tests/visual-comanda.test.cjs

Push por git CLI indisponível por falta de credencial no terminal; entrega da branch e PR feita pelo conector GitHub.

Validação final completa: 549 testes, 518 passaram, 29 falharam. As 29 falhas têm os mesmos nomes da base anterior; nenhuma falha nova. Testes direcionados: 3/3; SEO integrado: 2/2. git diff --check passou.
