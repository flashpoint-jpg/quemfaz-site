# Pedidos e divisão 87% / 13% — versão web 12.1.35

## Comportamento

- Cadastro no Livre, planos, apresentação do plano e carteira de comissão explicam a divisão proporcional: R$ 200 = R$ 174 para profissional e R$ 26 para intermediação. Custos e tributos não estão descontados; Avulso permanece sem comissão.
- Falha na consulta voluntária de oportunidades não interrompe a lista de pedidos próximos. A aba com erro informa a falha, sem afirmar que está vazia.
- Alertas locais respeitam horário, profissão, região e perfil ativo, sem depender do Online manual.
- Ficha administrativa consulta plano/validade, profissões, cidades/raios, horários e contagens distintas de compatíveis, distribuição, exibição, envio de push, desbloqueio, aceite e conclusão confirmada.
- Exibição é um registro novo: cartão com pelo menos 50% visível. Sem registro anterior a esta publicação não comprova ausência de pedidos recebidos.
- Diagnóstico de push deixa de classificar o Online antigo como impedimento. O espelho não apresenta rótulos Online/Offline antigos.

## Falha comprovada no backend

O reprocessamento de uma notificação compatível retornou HTTP 500, `shift_start_failed`, código SQL 42501. A função `qf_push_reservar_entregas`, com SECURITY INVOKER, consulta `private.qf_pedido_expiravel_72h`, que lê fechamentos e acordos. `service_role` não tinha SELECT em `qf_comissao13_fechamentos` nem `qf_comissao13_acordos`.

As duas migrações de permissão concedem somente SELECT ao backend. Não mudam a função para SECURITY DEFINER, não concedem acesso ao navegador e não alteram valores financeiros. Após o ajuste, o reprocessamento direcionado retornou HTTP 200: um destinatário, dois envios para suas duas inscrições. Registro de entrega ficou `enviado`, sem erro. Isso comprova aceite pelo provedor, não visualização no aparelho.

## Validação

- Build de produção e checagem de sintaxe.
- 14 testes direcionados de exibição/autorização, resiliência, abas, horário, Pix, plano, comissão e limite misto de quatro profissionais passaram.
- Navegador: 320, 390 e 1280 px, proporção 87/13, valores, ausência de overflow e pedido compatível visível com Online antigo desligado.
- Função de expiração validada sob `service_role`, após as concessões de leitura.
- Consulta administrativa validada no banco com autenticação administrativa e restauração da identidade.
- Suíte completa: 334 testes, 317 passaram, 15 falhas e 2 ignorados. As falhas já existiam no commit de base; nenhuma falha nova após comparar a mesma suíte com a base. Um erro de relógio na simulação de abas foi corrigido no harness.
- Contagens e hashes de assinaturas Livre, financeiro e Pix permanecem iguais antes/depois da migração.

## Publicação e limites

Commit de base/backup: a9972bfceb1d9c363a928f2d100c56162a4c11cf.

Esta alteração é da aplicação web. O repositório contém um pacote de referência para correção de notificações Android, sem o projeto Android completo e sem configuração oficial de assinatura. Não foi produzido AAB nem enviada atualização à Play Store. A confirmação no aplicativo instalado depende de ele carregar esta versão web; não foi validada em aparelho real.
