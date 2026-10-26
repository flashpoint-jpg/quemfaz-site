# Avisos, lembrete e painel de contratação

O cliente recebe o nome do profissional e o valor informado, com acesso direto ao chat de confirmação. O mesmo aviso aparece na home, na lista de pedidos e no acompanhamento protegido. O clique no aviso abre o pedido; não confirma a contratação.

A fila push existente recebe um aviso por versão da proposta. O cron `qf-comissao13-notificacoes`, já ativo a cada cinco minutos, passa a enfileirar um único lembrete após 24 horas sem resposta. O lembrete é descartado antes do envio se a proposta foi substituída, corrigida, recusada, confirmada ou se o pedido foi encerrado. A entrega push depende de inscrição e permissão de notificações do aparelho; o aviso dentro do aplicativo não depende de push.

O painel administrativo distingue Aguardando cliente, Correção de valor e Comissão vencida, com filtros rápidos, tempo decorrido e data de início. Os tempos são atualizados sem apagar os formulários em edição. A interface do profissional mostra serviço, comissão de 13% e valor após comissão antes de enviar, no pedido, carteira e chat.

Não há cobrança por silêncio, alteração de percentual ou redução do prazo de pagamento. A cobrança continua dependendo da confirmação explícita do cliente e do valor.

## Validação

- Build 12.1.33 aprovado.
- Testes de banco descartável e componentes reais em JSDOM: aviso imediato, conteúdo e destino, isolamento por sessão, limite de um lembrete por versão após 24 horas, descarte de notificações antigas, correção/cancelamento, nenhuma comissão por silêncio, arredondamento e prévia dos valores, filtros e tempo de espera no painel.
- Suíte completa: 322 testes, 303 aprovados, 17 falhas anteriores e 2 ignorados; nenhuma falha adicional em relação à versão anterior.
- Não foi realizado disparo de teste para clientes reais nem pagamento bancário real.

Migração: `20261026051302_melhorias_confirmacao_comissao.sql`. Aplicar no projeto Quem Faz antes de publicar o frontend. Usa a fila e o cron existentes, sem criar uma segunda rotina de disparos.
