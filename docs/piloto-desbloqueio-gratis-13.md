# Piloto — desbloqueio gratuito com comissão de 13%

Estado: especificação de implementação; **não ativado em produção**.

## Regras aprovadas
- O modelo tradicional de desbloqueio pago permanece inalterado, sem comissão.
- O profissional escolhe a modalidade a cada pedido, desde que o cliente aceite a modalidade.
- Limite compartilhado de 4 desbloqueios por pedido, nunca 4 por modalidade.
- No gratuito: desbloqueio sem débito de carteira; comissão de 13% sobre o valor efetivamente pago; 87% para o profissional, antes de taxas de processamento.
- O cliente confirma contratação e valor por link seguro enviado pelo WhatsApp; o servidor valida token e grava evento auditável.
- Após execução, o cliente confirma conclusão; o pagamento é solicitado apenas depois disso.
- Pagamento deve ser confirmado por webhook assinado do provedor. O repasse deve ser idempotente e só ocorrer após liquidação e verificações de risco.
- Painel administrativo e painel profissional recebem atualização por evento persistido e push, sem depender da entrega de push para garantir o registro.
- Não revelar contato sem desbloqueio autorizado; não permitir confirmação unilateral pelo profissional.

## Critérios de aceitação para ativação
1. Testar quatro desbloqueios mistos no mesmo pedido, concorrência simultânea e quinta tentativa negada.
2. Garantir que o fluxo tradicional, créditos e planos continuam funcionando.
3. Confirmar vínculo do cliente no link sem depender de número digitado; tokens expiram e não podem ser reutilizados.
4. Validar cálculo em centavos: R$ 500,00 => R$ 65,00 de comissão e R$ 435,00 de repasse antes de tarifas.
5. Impedir cobrança ou repasse em pedido contestado/cancelado; tratar reembolso e chargeback.
6. Confirmar eventos de webhook autenticados e idempotentes, logs e notificações ao admin.
7. Não ativar o gratuito antes de existir integração real de cobrança e repasse.

## Próxima etapa técnica
Adicionar tabelas de acordos, aceite do cliente, eventos financeiros e repasses com RLS; RPCs transacionais; interface de escolha por pedido; páginas públicas de confirmação por token; integração com provedor de pagamentos; testes E2E em sandbox.