# Validação Quem Faz Livre e comissão 13% — 23/10/2026

## Implementado

- Extensão dos fechamentos, links, códigos e fila de notificações existentes; nenhum segundo lançamento financeiro.
- Confirmação sem cadastro com token aleatório de 256 bits, validade de sete dias e uso único, mais OTP de cinco minutos para o telefone vinculado. O profissional nunca recebe esse link pelas APIs de cliente.
- Código de contratação associado ao fechamento/profissional; o OTP de identidade não deve ser compartilhado.
- Resposta do cliente, divergência e data no painel, com histórico administrativo e estado da notificação.
- Prestação de contas no pedido/chat; estado e comissão consultáveis na mesma tela.
- Carteira com extrato recolhido; novas ofertas restritas a Avulso, Livre R$39,90/30 dias e gratuito com 13%. Assinaturas antigas preservadas.
- Bloqueio de 48h entre modalidades e prorrogação única preservados e testados.

## Evidências

- Testes isolados de banco: Avulso, Livre, gratuito, limite misto de quatro, vigência de 30 dias, idempotência, saldo preservado, RLS e cobrança só após administração.
- Integração Efí simulada: valor, txid, titular, forma Pix e ativação somente depois da confirmação. Nenhuma cobrança real emitida.
- Novos testes guest: token, uso único, código incorreto, destino do SMS exclusivamente do banco, consentimento, indisponibilidade do provedor, prorrogação, liberação e divergência sem cobrança/suspensão.
- `tests/comissao13-live-rollback.sql`: executado com sucesso contra funções reais do projeto dczlyrgnzlxmzghzaooz. Sementes sintéticas, sem contato com clientes. ROLLBACK obrigatório, sem COMMIT; a fila pg_net não despacha solicitações não confirmadas.
- Bateria geral: 290 testes, 285 aprovados, 2 ignorados e 3 falhas anteriores à mudança. As mesmas três falhas foram reproduzidas no commit original ac11c92 em um checkout separado: atendimento.test.cjs, garante-novos-intencao.test.cjs e garante-por-orcamento.test.cjs. Não foram alterados o fluxo de publicação nem as regras de Garante nesta entrega.

## Impedimento externo confirmado

A Edge Function de produção informa `otp_configurado: false`. A confirmação por telefone permanece protegida: não se substitui por uma sessão de cadastro rápido nem se registra sucesso de SMS que não foi enviado.

A configuração esperada pelo serviço é `QF13_TWILIO_ACCOUNT_SID`, `QF13_TWILIO_AUTH_TOKEN`, `QF13_SMS_FROM` e `QF13_OTP_SECRET` (ao menos 32 caracteres), com remetente habilitado para os destinatários. Não inserir segredos no GitHub ou em mensagens. É necessário configurar um serviço de SMS válido no Supabase e validar entrega em número de teste autorizado para concluir a etapa externa.

A ausência do SMS não impede a revisão manual pelo administrador com evidência registrada. Não é prova de funcionamento completo da confirmação automática sem conta. Pagamento real de Pix, SMS real e dispositivo físico não foram exercitados.
