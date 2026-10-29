# Marketing Dedicado e financeiro — implantação de 29/10/2026

## Corrigido

O controle de Pix integral ficava abaixo do histórico extenso em `/admin.html#/admin/financeiro`. O carregamento também consultava o banco local de profissionais no administrativo e lançava erro. O financeiro passa a montar o controle e o livro de Pix antes da tabela operacional, com consulta bancária, exportação CSV, evidências de repasse e auditoria privada. Valores sem conciliação e E2E não compõem entradas nem obrigações. Os 87% pendentes são obrigação com o profissional.

O menu principal e a Carteira recebem Marketing Dedicado: oferta opcional, solicitação sem cobrança, revisão, configuração, link opaco, estados e acompanhamento com dados do banco. O link requer consentimento para preservar a origem por sete dias. Pedidos efetivamente publicados geram atribuição única; origem posterior é imutável. A janela de prioridade aplica elegibilidade atual, com guarda no desbloqueio e retorno ao fluxo comum. Nenhuma campanha histórica é convertida ou duplicada.

## Limites da liberação

**A missão completa não está concluída.** Marketing está liberado para solicitar e revisar propostas. Venda e ativação continuam bloqueadas no servidor. O checkout implementado aceita R$ 550 ou R$ 589,90 somente com o preço confirmado e após liberação operacional; testes usam banco simulado. Não houve cobrança, campanha Meta nem transferência real nesta execução.

Faltam integração Meta com verificação de entrega e pausa efetiva automática, homologação bancária completa e confirmação específica da Efí/revisão fiscal e KYC para receber serviços de terceiros. Recebimento de assinaturas existentes não comprova essa autorização. O diagnóstico administrativo mostra a configuração real sem revelar credenciais. Nenhum botão pode transformar solicitação em pagamento ou campanha ativa manualmente.

O fluxo real de cobrança, webhook, restituição e repasse, a contratação conjunta no cadastro, retomada OAuth e os 30 dias efetivos de anúncios ainda precisam de validação de ponta a ponta com as integrações autorizadas. O checkout do Marketing não substitui o checkout atual da assinatura. Não habilitar venda antes de concluir essa validação.

## Validação

Base original `8e11af21f10fa88918d16a83115e9811afb536dc`: 434 testes, 417 aprovados, 15 falhas e 2 ignorados no ambiente Windows. A mesma lista de falhas foi reproduzida após a alteração; nove testes novos cobrem os novos fluxos. SQL isolado verifica permissões, idempotência, atribuição e janela de prioridade. A API bancária é simulada nesses testes; isso não equivale a homologação Efí.

Os testes preexistentes falham em arquivos ausentes/expectativas antigas de planos e consentimento, regras de push/origem e fixtures Efí no Windows. Não foram alterados para mascarar falhas.

## Reversão

Reimplantar a versão Git anterior na Vercel restaura a interface. Preservar os registros financeiros e as tabelas de auditoria. A configuração `private.qf_livre_manual_config.habilitado` permanece falsa. A venda de Marketing é bloqueada por `private.qf_md_config.entrega_validada=false`.

Se for necessário retirar a prioridade, remover a condição `and private.qf_md_prioridade_permite(p_pro,p_chamado_id)` da função `private.qf_pro_recebe_chamado`, desabilitar `qf_aa_md_guardar`/`qf_md_aceite` em `qf_desbloqueios` e `qf_aa_md_atribuir` em `qf_chamados`, e retirar o agendamento `qf-md-prioridade`. Fazer isso mediante migração revisada, preservando origem e auditoria; não apagar tabelas ou transações.

