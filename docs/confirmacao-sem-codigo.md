# Contratação sem código

O profissional informa o valor combinado na carteira, no pedido ou no chat. O cliente confere profissional e valor e confirma uma vez pelo chat autenticado ou pelo acompanhamento protegido do navegador que publicou o pedido.

A confirmação gera 13% para o profissional, inclui uma única cobrança na fila Pix existente e concede 48 horas para pagamento. A regra de bloqueio passa a considerar o vencimento. Silêncio ou valor ainda em correção não gera comissão; a proposta enviada não provoca bloqueio por falta de resposta do cliente. A conciliação bancária existente permanece responsável pelo pagamento.

O cliente pode pedir correção antes de confirmar. O profissional envia novamente e a confirmação precisa corresponder ao valor exibido. Repetir a confirmação não duplica a cobrança; o pedido aceita apenas um profissional confirmado. A chave privada de acompanhamento e a autenticação do chat permanecem; o código compartilhado de contratação deixa de aparecer e não autoriza cobranças. Códigos de recuperação de acesso e Pix têm finalidades diferentes e são preservados.

Não há atualização retroativa de fechamentos ou cobranças: registros anteriores que aguardam análise continuam no painel administrativo.

## Validação

- `npm run build`: aprovado.
- `node --test tests/contratacao-sem-codigo.test.cjs tests/acompanhamento-codigo.test.cjs`: cobre contratação sem código, confirmação com um clique nos componentes reais em JSDOM, valor desatualizado, correção, isolamento, repetição, um contratado, comissão, fila Pix única e bloqueio após 48h em Postgres descartável (PGlite).
- Suíte geral comparada com checkout limpo de `157b46d`: mesmas 17 falhas anteriores, sem falhas adicionais. Não é uma suíte completamente aprovada.
- Chromium não pôde ser instalado neste ambiente: o download retornou arquivo truncado. Não foi realizado teste visual em navegador completo nem pagamento bancário real.

## Publicação

Aplicar somente `20261026014226_confirmacao_contratacao_sem_codigo.sql` no projeto `dczlyrgnzlxmzghzaooz`, antes da publicação do frontend. O build e o service worker recebem a versão 12.1.32 e novas URLs para os scripts alterados.

O parâmetro de valor do acompanhamento é opcional no contrato da API para permitir leitura por versões anteriores; confirmar sem valor é recusado. Não há atribuição automática de pedidos antigos a novos navegadores.
