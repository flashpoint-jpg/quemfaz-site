# Emergência de aquisição — 27/10/2026

## Proteção do orçamento

Conta Google Ads 734-351-8086. Consulta após escrita confirmou seis campanhas PAUSED. Duas estavam ENABLED: 24318526983 (reparos/limpeza, R$29,20/dia) e 24310102048 (instalação/pintura, R$30,80/dia). Ambas foram pausadas com write_status=applied. As outras quatro permaneceram pausadas. Nenhum orçamento, anúncio, segmentação ou histórico foi excluído ou alterado. Não reativar mídia paga sem autorização expressa do proprietário.

## Gastos: limite da investigação

Solicitadas duas consultas para 21–27/10/2026, fuso America/Sao_Paulo: totais por campanha e termos de pesquisa com custo/cliques/conversões. Ambas recusadas com TRIAL_EXPIRED pelo Supermetrics. O acesso de administração permitiu pausar e reler as campanhas; o acesso analítico ficou bloqueado. As duas conexões Windsor disponíveis só retornaram Meta, sem Google Ads. Não houve contratação de assinatura. Não há valor de gasto nem ranking de pesquisas comprovados nesta execução.

## Evidência do banco em produção

Foram encontrados 21 registros de pedidos no intervalo consultado: 11 com origem Google e identificador gclid, 5 sem origem, 5 com outras origens registradas. Esses registros não foram classificados individualmente como clientes reais, testes ou receita. Há 19 cancelados e 2 em negociação; cancelado não prova ausência de tentativa de contato.

Pedido de marido de aluguel em São Paulo em 27/10 às 12h55 (horário de Brasília): gclid e UTM Google presentes; 8 profissionais com registro de exibição; 1 desbloqueio ativo; status em negociação. Nenhuma conclusão/receita foi comprovada. Esse pedido teve 28 envios aceitos pelo provedor, 24 registros sem inscrição e 2 inscrições expiradas.

No período, qf_push_entregas tinha 268 registros enviados, 243 sem inscrição e 3 falhos com subscription_expired. Esses números são registros de tentativas/distribuição, não pessoas únicas. Aceite pelo provedor não comprova toque no aparelho. Inscrição expirada ou ausente depende de nova autorização/registro no dispositivo; não se pode conceder isso pelo servidor. Não foi realizado disparo geral nem alteradas regras de raio/horário.

## Defeitos corrigidos

- Reproduzido no site: botão Eletricista não avançava. Atalhos ainda submetiam o formulário antigo removido. Agora abrem o formulário atual dentro do card, com a profissão correta. Pedir grátis/Serviços focam o card atual.
- Links de serviço/SEO passam a conservar a categoria na entrada do Pedido Fácil, inclusive categorias fora do antigo mapa resumido.
- Removido o padrão que marcava qualquer utm_source ou fbclid como paid. UTM explícita é preservada; identificadores de anúncio Google/Microsoft/TikTok indicam CPC; fbclid isolado permanece com meio desconhecido. Histórico não foi reescrito. Origem sem evidência não é inventada.
- O formulário atual passa a registrar início, etapas, tentativa, erro de validação, erro de acesso e erro de publicação, usando eventos já aceitos pelo banco. Respostas pessoais não são enviadas para o funil. A conversão de publicação continua dependente do ID confirmado no banco.
- Corrigidas frases incompatíveis com o acesso atual por telefone e senha, chat no Livre e WhatsApp no avulso; removidas promessas de resposta em até uma hora.

## SEO e publicação

Auditoria do artefato: 172 URLs únicas no sitemap, páginas públicas com title/description/canonical próprios; nenhuma URL noindex no sitemap; páginas genéricas mantêm noindex e guias canônicos continuam descobríveis. Não foi forçada indexação nem prometida posição no Google. Correção funcional dos links ao formulário faz parte desta versão.

Versão preparada: 12.1.43. Verificar a publicação no domínio após o deploy.

## Validação e limites

Testes de regressão dos atalhos, links SEO, origem e funil; publicação do formulário atual em PostgreSQL local com função transacional da fixture de produção; retorno ao acompanhamento na mesma página; testes existentes de aquisição, conversão, exibição e SEO. Nenhum pedido fictício ou notificação de teste foi criado em produção.

Quatro testes antigos de atendimento/acompanhamento falharam também na main anterior 7784cd3: fixtures ainda não contemplam concordância e acesso por senha atuais. Não foram apresentados como aprovados. Dois testes de abas tinham pedidos com data fixa que expiraram em 72h; apenas as datas da fixture foram tornadas relativas, sem mudar a regra de produção.

A instalação do navegador local de testes falhou por download inválido; a conferência visual do site publicado usa o navegador disponível. Teste local de PostgreSQL não equivale a autenticação real de um novo cliente em produção.

## Divulgação orgânica preparada

Textos e links no arquivo `2026-10-27-divulgacao-organica.md`. Nenhuma postagem foi publicada em rede social: a missão solicitou preparar a divulgação. Não foram criados anúncios nem feita impulsão.
