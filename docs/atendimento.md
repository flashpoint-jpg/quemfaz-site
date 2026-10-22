# Atendimento obrigatório — proposta em branch

Esta implementação não foi aplicada ao banco de produção nem integrada à main. A liberação será coordenada após validar banco, frontend e integrações.

## Comportamento

Os dois pontos de entrada (cliente sem conta e cliente autenticado) usam o mesmo atendimento determinístico, sem serviço pago de IA. Há uma pergunta por vez; serviço, detalhes, escopo, cidade, UF, bairro, urgência, orçamento (ou a combinar), materiais, data, disponibilidade, nome, celular, intenção e autorização são obrigatórios. Perguntas de limpeza, obras, manutenção e montagem se adaptam à profissão. O cliente revisa as respostas antes da publicação gratuita. Negar consentimento impede a publicação; pesquisar preços continua permitido no tradicional.

Tradicional: quatro vagas, preservando as regras financeiras e os planos existentes. Quem Faz Garante: uma vaga, intenção de contratar, orçamento numérico, materiais definidos, data e disponibilidade, declaração de escopo e poder de decisão. O profissional precisa de verificação e documento, além da elegibilidade atual de profissão/região. O desbloqueio usa saldo, cobra exatamente quatro vezes o preço normal e não consome plano. Não há promessa de contratação nem de execução. Um contato Garante nunca é vendido a outro profissional, inclusive depois de estorno/desativação.

## Banco, privacidade e duplicação

A migração acrescenta um arquivo privado de respostas e duas referências no pedido. Não reclassifica pedidos antigos nem altera preços normais, recargas ou pagamentos. A criação usa `qf_publicar_atendimento`; o banco valida identidade, campos e consentimento. O trigger impede inserção direta sem registro de atendimento. Atualizações de status de pedidos antigos continuam passando.

Respostas completas, nome, contato e consentimento ficam em `private.qf_atendimentos`, com RLS e sem acesso direto para anon/authenticated. A RPC de respostas permite somente titular, administrador ou profissional com desbloqueio ativo. Texto público recusa padrões de contato e endereço; nome e telefone não são adicionados à descrição. Endereço exato não é solicitado. O app não persiste respostas pessoais em localStorage/sessionStorage; mantém apenas a chave aleatória de repetição. Excluir um perfil limpa as respostas privadas, sem adicionar um bloqueio à exclusão do cadastro.

Chave UUID + locks transacionais evitam repetição do mesmo envio. Um fingerprint privado de contato, categoria, escopo, local e data reúne pedidos equivalentes por 24 horas, inclusive entre contas rápidas diferentes (sem revelar o pedido de outra conta). Retry devolve o pedido existente e não repete o INSERT nem seus triggers. Os callbacks de notificações e pagamentos atuais permanecem. As funções financeiras foram capturadas por consulta somente leitura do projeto atual, e o desbloqueio mantém sua transação/travas; apenas Garante acrescenta qualificação e preço fixo 4×.

O painel administrativo mantém seu snapshot e mostra modalidade, escopo e botão para consultar respostas e autorização, com data do servidor. A origem comercial do pedido continua sendo enviada.

## Verificação reproduzível

- `npm ci && npm test`: build, regressões e PostgreSQL isolado em PGlite.
- `npx playwright install chromium && npm run test:atendimento:browser`: navegador móvel com tráfego externo bloqueado; roteador compilado → perguntas → revisão → `createCall` real → RPC HTTP local → banco isolado → débito → bloqueio do segundo profissional. Sessão/cadastro, geocodificação e push usam fixtures locais; não há chamada a prestadores reais.
- `QF_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/qf_atendimento_test npm run test:atendimento:postgres`: banco descartável vazio, seis conexões concorrentes; uma publicação, até quatro compras tradicionais e uma compra Garante, com conferência do saldo e livro de débitos. Recusa hosts remotos e outros nomes de banco.
- `.github/workflows/atendimento-ci.yml`: repete regressão, navegador e concorrência em PostgreSQL 17. Executa também o teste preexistente de pagamentos em banco descartável.

As fixtures preservam as funções financeiras consultadas em produção, mas modelam parte do esquema e elegibilidade. A verificação seguinte reconstruiu, sem dados pessoais, as 67 tabelas, 302 funções, 53 gatilhos, views e permissões do Supabase em uma branch temporária. Nesse ambiente passaram a migração, o cadastro rápido pela Edge Function, Auth/OTP, publicação dos dois modos e painel do cliente pelo navegador. O tradicional manteve quatro desbloqueios; Garante cobrou 4× e recusou um segundo profissional; dados completos ficaram indisponíveis antes do desbloqueio. A função de push respondeu HTTP 200, sem dispositivos reais cadastrados. O ambiente temporário foi removido após a orientação de somente subir o código. Não houve cobrança real, alteração de produção ou teste de entrega em um aparelho físico; webhooks da Efí continuam cobertos pela regressão isolada de pagamentos. A falha preexistente do teste de labels do admin foi reproduzida na main e a expectativa foi atualizada aos labels atuais, sem modificar os filtros.

## Critérios de liberação em produção

1. Exigir CI verde, inclusive concorrência real e pagamentos; não integrar um PR com execução pendente ou erro.
2. Conferir novamente o esquema no momento de uma futura publicação. A cópia completa foi exercitada em homologação; advisors identificaram o índice da nova FK, que foi acrescentado, e as RPCs SECURITY DEFINER deliberadamente limitadas ao usuário/owner/admin/desbloqueio.
3. Homologar criação e desbloqueio tradicional/Garante, notificações reais para contas de teste (raio, online e horário), estorno administrativo, painel e webhooks de pagamentos em sandbox.
4. Preparar atualização obrigatória dos clientes antigos/PWA antes do corte: a API antiga não poderá publicar sem atendimento. Isso é intencional e não pode virar fallback silencioso que contorne consentimento. Uma implantação sem coordenar app e migração interromperia novos envios de versões antigas.
5. Capturar e comparar as definições de funções/colunas/triggers novamente antes de aplicar; a migração parte do estado consultado nesta revisão. Produção continua sem alterações enquanto não houver evidência desses testes.

Não é possível afirmar ausência de interrupção em todas as versões instaladas apenas com testes de fixtures. Essa é uma condição de liberação, não uma garantia já comprovada.

## Reversão

Antes do corte, salvar as definições atuais de `qf_desbloquear_chamado`, permissões e triggers. Se houver falha, reverter primeiro o cliente para o release anterior e remover a obrigatoriedade do trigger de INSERT em uma janela coordenada; restaurar a função financeira capturada. Não apagar respostas, pedidos, cobranças ou colunas na reversão. A decisão de permitir temporariamente a API antiga deve ser explícita, pois suspende a regra de 100% de atendimento.

A troca futura pode preparar o banco com `qf_config.atendimento_obrigatorio = {"ativo": false}` somente durante a implantação coordenada e ativar `true` após o frontend validado estar disponível. Ausência da chave significa obrigatório. O estado final de operação deve ser `true`; os testes cobrem a passagem de preparação para obrigatoriedade. Nada disso foi ativado em produção.

Teste reproduzível em Supabase descartável: `QF_STAGING_CONFIG=/caminho/config.json QF_STAGING_TIPO=tradicional npm run test:atendimento:supabase`, repetindo com `garante`. A configuração contém somente `url` e chave publicável do projeto de teste; o script recusa o projeto de produção e bloqueia tráfego a outros serviços.

Localização: antes de inserir, a RPC usa a coordenada resolvida pelo navegador ou a referência existente de cidade/UF em `qf_cidades_coord`. Sem nenhuma coordenada válida, recusa a publicação com mensagem específica e mantém as respostas na tela, evitando um pedido invisível para os profissionais. O navegador de homologação mantém o geocodificador externo bloqueado para exercitar essa alternativa real.
