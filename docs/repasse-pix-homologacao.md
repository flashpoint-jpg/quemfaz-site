# PR 147 — envio Pix a qualquer banco, ainda bloqueado

Esta PR não é homologação bancária e não deve ser publicada em produção.

## Implementado e testado localmente

- Cadastro existente da Carteira (PR 148) sincroniza o cadastro privado de recebedores; troca da chave invalida a validação anterior. Documento inválido impede habilitação.
- Cobrança integral somente para fechamento Livre com conclusão e valor confirmados pelo cliente; recusa cobrança anterior para evitar duplicar o Pix de 13%.
- Validação de entrada exige txid, valor, situação concluída e endToEndIds distintos; devoluções presentes impedem envio automático.
- Saída exige consulta por idEnvio, status REALIZADO, chave e valor correspondentes. Não usa a resposta da solicitação como prova de crédito.
- Reserva global persistente limita operações concorrentes, com idEnvio fixo em todas as retentativas. Um envio pendente impede outro até resolução.
- Baixa da comissão só ocorre após a confirmação de saída; reprocessar entrada/saída não duplica a baixa. Avisos de pagamento e repasse têm chaves distintas e são idempotentes.
- Retentativas de notificação independem de `novo=true`: falhas temporárias podem ser recuperadas pelo próximo processamento.
- Flags adicionais de webhook, limites e tarifas são falsas por padrão. Nenhum envio habilitado por esta PR.

Validação: `node --test tests/repasse-conciliacao.test.cjs tests/repasse-provas.test.cjs tests/livre-pix-propria-conta.test.cjs tests/livre-pix-profissionais-existentes.test.cjs` — 11 testes aprovados. O PostgreSQL é local/PGlite e a autorização bancária é simulada; não foi enviado Pix real.

## Antes de ativar

1. Confirmar na conta Efí autorização `pix.send` e `gn.pix.send.read`, certificado e chave pagadora.
2. Implementar e homologar webhook autenticado associado à chave pagadora; eventos devem provocar consulta bancária, nunca ser aceitos como prova por si só. Essa entrada de webhook ainda não está implementada nesta função.
3. Confirmar limites e tarifas da conta e custear tarifas sem descontar silenciosamente dos 87%.
4. Definir tratamento administrativo de rejeição definitiva, devolução parcial/total, contestação e estorno posterior ao repasse. A rejeição de devoluções antes do envio existe, mas a reconciliação contínua após liquidação ainda precisa ser concluída.
5. Homologar beneficiários de bancos diferentes, documento divergente, saldo insuficiente, limites, timeout, retentativa do mesmo idEnvio, concorrência e recuperação dos avisos nos aparelhos.
6. Integrar o painel financeiro ao novo livro de pagamentos quando sua migração for publicada, sem misturar o split antigo e o novo envio Pix.

Documentação oficial conferida em 28/10/2026:
- https://dev.efipay.com.br/docs/api-pix/envio-pagamento-pix/
- https://dev.efipay.com.br/docs/api-pix/webhooks/

Não foi possível comprovar as permissões bancárias e tarifas da conta por estas ferramentas; ausência de comprovação não significa que a Efí já recusou a autorização.
