# Marketing Dedicado — prioridade paga e anúncios manuais

Atualizado em 29/10/2026 após confirmação do administrador: os anúncios são criados manualmente na conta do Quem Faz. Não existe requisito de integração Meta nem de link exclusivo para receber prioridade.

## Operação

1. O profissional solicita uma proposta sem cobrança. O administrador revisa e aprova para pagamento.
2. Na Carteira / Meus planos, o profissional confirma o valor antes de gerar Pix: R$550 pelo Marketing (R$300 de mídia e R$250 de gestão), ou R$589,90 incluindo Livre pago quando necessário. Teste grátis não equivale a Livre pago.
3. A consulta à Efí verifica txid, valor integral e identificador bancário E2E. A conciliação é idempotente. O conciliador existente quemfaz-efi-pix-sync inclui o módulo _shared/marketing-sync.ts, a cada minuto, mesmo com o aplicativo fechado. A consulta na tela também confirma o pagamento.
4. Após conciliação, com Livre pago ativo, começa a prioridade de 30 dias. Os anúncios são administrados manualmente pela equipe. Não há renovação automática nem garantia de pedidos ou faturamento.
5. Qualquer pedido publicado pode gerar a primeira oferta. Valem os serviços e a região do perfil operacional do profissional, sua disponibilidade, horário e conta ativa. Os campos da proposta orientam a criação dos anúncios; não ampliam o território nem os serviços do perfil.
6. Entre profissionais com Marketing elegível, recebe a primeira oferta quem está há mais tempo sem uma oferta. A seleção é serializada no banco. Tokens e links antigos não alteram a escolha.
7. A janela padrão é de 15 minutos, ou 5 para urgentes, configurável no administrativo. Após aceite, recusa, vencimento ou perda de elegibilidade, o pedido segue para os demais pelas regras existentes. O limite de desbloqueios e a proteção dos contatos continuam nos fluxos existentes.
8. O profissional pode recusar a primeira oferta em Carteira / Meus planos → Pedidos e histórico. Também pode pausar a prioridade. O administrador pode pausar/retomar, sem reiniciar o saldo dos 30 dias. A equipe deve pausar/retomar os anúncios manualmente na Meta.
9. A perda do Livre pago interrompe a prioridade imediatamente no filtro. A rotina registra a pausa e libera os avisos em até um minuto. Pagamento em análise, estornado ou contestado não habilita prioridade. O pagamento simultâneo do Livre durante um Pix conjunto exige revisão da parcela; não cria outra assinatura automaticamente.

## Implementação e implantação

A migração 20261029162528_marketing_prioridade_paga_gestao_manual.sql usa a versão efetivamente retornada pelo Supabase. Não cria pedidos ou profissionais artificiais em produção.

O código do conciliador Efí preexistente é mantido no ambiente de funções e contém uma configuração interna que não deve ser publicada no repositório. O arquivo supabase/patches/quemfaz-efi-pix-sync-marketing.patch documenta somente as três alterações aplicadas nele. O módulo compartilhado é versionado integralmente, sem credenciais. A função de Marketing preserva autenticação JWT; a autenticação interna do conciliador existente é preservada.

As tabelas de campanhas, pagamentos, leads e auditoria permanecem privadas com RLS e sem acesso direto de clientes. Apenas o servidor concilia pagamentos; o administrativo não consegue marcar um recebimento como pago. A emissão exige consentimento de preço e proposta aprovada. Uma consulta de status não cria cobrança.

## Validação e limites

Testes isolados de PostgreSQL verificam permissões, preço, exclusão de teste grátis, compra conjunta, idempotência, ativação, pedido orgânico, alternância, recusa, prazo, compatibilidade, pausa/retomada e término. Testes da interface e do banco simulado cobrem consentimento e valor, falta de autenticação, inexistência de cobrança ao abrir a tela e conciliação em segundo plano. Não houve compra nem pagamento real de Marketing nesta execução; os testes bancários usam respostas simuladas.

A verificação geral apresentou 445 testes: 428 aprovados, 15 falhas preexistentes e 2 ignorados. O teste de conciliação em segundo plano foi acrescentado depois e passou no conjunto focado. As falhas antigas não foram ocultadas nem alteradas.

Pix integral de serviços e repasse manual de 87% são fluxos separados. Sua configuração operacional permanece bloqueada; esta alteração libera somente o Marketing descrito acima.

## Reversão

Para suspender novas compras, definir private.qf_md_config.entrega_validada=false e pausar campanhas ativas. Não apagar pagamentos, leads ou auditorias. Restaurar a versão anterior das telas e reverter somente o patch do conciliador retira esta interface e a conciliação do Marketing, preservando a rotina de pagamentos existente. Campanhas pausadas deixam de reservar pedidos; a função central libera os demais profissionais.
