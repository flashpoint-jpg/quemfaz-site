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
## Carteirinha digital obrigatória e comunicação
- Avisar no painel profissional sobre a nova modalidade gratuita com comissão de 13%, com aceite explícito das condições antes do primeiro uso.
- Para optar pelo desbloqueio gratuito, o profissional deve possuir carteirinha digital ativa no aplicativo; não é necessário imprimir.
- Exibir a carteirinha com QR Code na tela do celular ao cliente, presencialmente, para identificação e acesso ao fluxo seguro de confirmação da execução.
- Oferecer link seguro como alternativa à leitura do QR Code, sem exigir impressão nem instalação de aplicativo pelo cliente.
- Não usar a simples leitura do QR Code como prova automática de execução: exigir confirmação explícita do cliente e validação no servidor.
- O desbloqueio tradicional continua disponível mesmo para profissionais que ainda não tenham aderido à modalidade gratuita.
- Registrar aviso e aceite no backend; push é complemento, não substitui registro persistido no painel.

## Confirmação segura pelo telefone do cliente
- O QR Code da carteirinha digital apenas abre a página do pedido; nunca confirma automaticamente a conclusão.
- Antes de aceitar a conclusão, exigir código OTP de uso único enviado ao telefone do cliente verificado e associado ao pedido (SMS ou WhatsApp por provedor confiável).
- Validar OTP exclusivamente no servidor, com validade curta, limite de tentativas, rate limiting, hash do código, vínculo ao chamado e invalidação após uso; nunca revelar OTP ao profissional.
- Acesso autenticado do profissional, QR Code ou simples posse do link não podem aprovar conclusão ou pagamento.
- Confirmar explicitamente serviço, valor e profissional na tela do cliente; permitir 'Não concluído / Contestar'.
- Registrar evento auditável, evitar dupla confirmação e bloquear cobrança/repasse durante contestação.
- Não alegar que OTP prova identidade física ou posse exclusiva do aparelho: confirma controle do canal cadastrado. Em suspeita de fraude, exigir revisão administrativa.

## Estado da implementação (2026-10-22)
- Migração isolada aplicada no Supabase: tabelas `qf_comissao13_adesoes`, `qf_comissao13_acordos`, `qf_comissao13_eventos`.
- Verificado: RLS habilitada nas três tabelas, sem políticas permissivas, e `authenticated` sem SELECT.
- Nenhum desbloqueio gratuito foi ativado e o fluxo tradicional não foi modificado.
- Pendente: RPCs seguras, UI, OTP, pagamentos e repasses, notificações e testes ponta a ponta.

## Continuação implementada em 22/10/2026

O piloto permanece **bloqueado para novos desbloqueios gratuitos**. Não houve teste financeiro aprovado nem contratação real pelo piloto.

Implementado:
- RPC transacional de desbloqueio sem débito, com a mesma linha de bloqueio do tradicional, mesma tabela de participantes e limite compartilhado de até quatro; preserva Garante e utiliza a elegibilidade real da vitrine.
- Proposta de acordo pelo profissional com valor em centavos, data, telefone obtido exclusivamente do cliente vinculado ao pedido, link aleatório com hash e validade de sete dias.
- Confirmação de contratação, conclusão ou contestação por OTP: HMAC SHA-256 com segredo do servidor, vínculo ao token/finalidade, cinco minutos, cinco tentativas por código, limites de reenvio e bloqueio por tentativas acumuladas. RPCs de OTP exclusivas de service_role.
- Endpoint `quemfaz-comissao13`, com adaptador de SMS Twilio. Só registra aceite de envio após resposta real do provedor; nunca declara entrega ao celular. Sessões autenticadas não podem usar o endpoint de confirmação do cliente.
- Tela do profissional com modalidade/condições e bloqueio explícito enquanto não houver validação; formulário de acordo e compartilhamento manual pelo WhatsApp preparados. Não há envio automático de WhatsApp.
- Página pública `comissao13.html`, sem cadastro/instalação, com conferência do profissional/pedido/valor e confirmação explícita, OTP e contestação.
- Painel administrativo e do profissional com estado dos acordos, comissão de 13%, parcela de 87% antes de taxas e indicadores pendentes de pagamento e repasse. Estes indicadores não representam um livro financeiro integrado.
- Acesso à carteirinha digital no celular; impressão deixou de ser obrigatória na interface.

### Validações realizadas
- `npm test`: 272 aprovados, 0 falhas, 2 ignorados, em 274 testes.
- Testes específicos executam PL/pgSQL em PostgreSQL embarcado (PGlite), inclusive reaplicação idempotente, permissões de anon/authenticated, desbloqueios mistos, saldo preservado, adesão, profissão, raio, OTP incorreto/expirado/não enviado/reutilizado, confirmação explícita, contestação e cálculo R$500 => R$65/R$435.
- Corrigida uma asserção de teste anterior que ainda esperava chamada direta da RPC tradicional antes da introdução da cortesia de reativação. A mesma falha foi reproduzida no commit original `f63f8e4`.
- Endpoint real respondeu `otp_configurado:false`, `financeiro_servicos_integrado:false`, `ativo:false`; links inexistentes são negados e envio sem configuração retorna HTTP 503.
- Conferência no Supabase: nenhum desbloqueio/acordo do piloto; anon/authenticated sem acesso às tabelas e sem execução das RPCs de confirmação do servidor.

### Dependências e trabalho ainda necessário para ativar
1. Configurar e validar um provedor real de OTP. O adaptador atual espera `QF13_TWILIO_ACCOUNT_SID`, `QF13_TWILIO_AUTH_TOKEN`, `QF13_SMS_FROM` e `QF13_OTP_SECRET` (segredo aleatório de ao menos 32 caracteres), cadastrados diretamente nos segredos do Supabase. Nenhum segredo deve ser enviado em conversa ou commit.
2. Implementar e aprovar cobrança de serviços Pix/cartão, webhook autenticado, registro financeiro, taxas, estornos, chargebacks, identificação dos recebedores e repasse idempotente. A integração Efí existente inspecionada é de recargas/anúncios/prioridade/planos; não foi reaproveitada indevidamente como liquidação de serviços.
3. Conectar a leitura do QR estático da carteirinha à seleção segura do acordo da modalidade 13%; o QR atual de avaliações foi preservado. O link específico do acordo já tem página com OTP.
4. Implementar fila e disparos dos novos eventos/push de anúncio com deduplicação e regras de horário. Nenhum push anunciando modalidade ativa foi disparado.
5. Aprovar testes com sessões PostgreSQL independentes de concorrência e E2E visual em celular/desktop. O PGlite testa as regras transacionais, mas não demonstra concorrência entre sessões. O navegador local não ficou disponível: download do Chromium retornou arquivo inválido. A instalação de PostgreSQL independente também não estava disponível neste ambiente.
6. Revisar tarifas e termos financeiros efetivos antes de expor escolha ativa. Não alterar a tabela privada de prontidão para habilitar o piloto antes de completar os itens acima.

O fluxo tradicional, créditos, planos, Garante e pedidos existentes não foram substituídos. A modalidade gratuita não está operacional de ponta a ponta.
