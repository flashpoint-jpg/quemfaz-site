# Verificação geral de pedidos — web 12.1.36

A consulta do portfólio e a consulta voluntária foram executadas para os 353 profissionais ativos. Resultado: zero erros de consulta e zero pedidos omitidos ao comparar o portfólio com as regras atuais de profissão, região, vaga, desbloqueio, conclusão e expiração. Foram encontradas 103 relações de profissional/pedido elegíveis; esse número não significa 103 pedidos diferentes ou visualizações em aparelhos.

Correções adicionais:

- A assinatura rápida usada pelo polling deixava de atualizar toda a lista quando `qf_mais_oportunidades` falhava. Agora registra um estado de indisponibilidade para essa consulta e continua detectando novos pedidos próximos.
- O catálogo de preços, protegido para usuários autenticados, era consultado pela página anônima. Isso gerava SQL 42501. O frontend passa a consultá-lo após restaurar a autenticação ou receber o evento de login. Não foram ampliadas permissões públicas nem alterados os preços.

Testes: falha da consulta voluntária como resposta de erro e como rejeição de rede; detecção de um novo pedido durante essa falha; nenhuma leitura de preços sem sessão; leitura após login; invariantes das abas e cadastro de exibição. Navegador em 320/390/1280 px passou.

Limite da comprovação: consultas do servidor e testes de interface não comprovam exibição nos 353 aparelhos. Push depende de inscrição ativa e aceitação pelo provedor, além das regras de elegibilidade e horário.
