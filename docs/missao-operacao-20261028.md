# Verificação operacional — 28/10/2026

## Correções desta entrega

- Carteira monta o cadastro Pix antes da consulta da assinatura. Uma falha da consulta do plano deixa de esconder o formulário. Nenhuma conta Efí exigida; registro permanece no perfil existente, sem alterar Avulso.
- Menu administrativo **Financeiro e Pix**: todos os pedidos, participantes das negociações, valores combinados e confirmados, comissão prevista/conciliada, repasses com evidência, chaves cadastradas/pendentes, cidades, profissões, raios e horários, últimos dez pedidos e dez eventos de publicação. Filtros e cards clicáveis.
- RPC administrativa protegida por identidade de administrador verificada no servidor. Nenhum botão autoriza pagamentos ou valida titularidade sem evidência bancária.
- Atualização do app e Service Worker para 12.1.45.

## Evidências

- `tests/pix-producao-rollback.sql`: executado no Supabase de produção. INSERT e UPDATE próprios passaram; SELECT/UPDATE/INSERT entre profissionais bloqueados; administrador visualizou a chave; não administrador impedido de acessar o painel. Transação revertida. Zero chaves fictícias persistidas.
- A consulta administrativa retornou 97 pedidos, 371 profissionais e 10 eventos recentes de publicação no momento da auditoria.
- 29 testes direcionados passaram: Pix, contabilidade, negociações, CEP, conversões e checkout da assinatura Efí, incluindo valores/identidade divergentes.
- `tests/pedido-home.browser.cjs`: passou em 390 e 1280 px com o frontend compilado e PostgreSQL local. Publicação realmente gravada no banco de teste; autenticação simulada; chat/aceite/conclusão simulados pela API de teste. Conversão disparada uma vez, somente depois da publicação, e deduplicada no retry. Tags externas bloqueadas: não comprova atribuição recebida pelo Google Ads.
- `tests/operacao.browser.cjs`: painel e filtros em 320, 390 e 1366 px; sem overflow. Imagens em `docs/evidencias-operacao/` usam dados fictícios.
- Suíte geral anterior às alterações: 379 testes, 357 aprovados, 20 falhas e 2 ignorados. Vários testes ainda exigem telas/perguntas substituídas por CEP e descrição livre. A suíte geral não está verde. Não se afirma homologação integral de produção.
- Browser de produção confirmou home atual e painel com autenticação obrigatória. Não havia sessão administrativa/profissional autenticada neste navegador; não se criou pedido fictício em produção nem se notificou profissional real.
- Push dos sete dias consultados: 273 envios aceitos, 243 registros sem inscrição e 3 falhas. Envio aceito não comprova exibição/leitura. Teste de push com celular fechado não realizado.

## Campanhas e orçamento

Valores abaixo são **orçamentos configurados, não gastos realizados**.

| Canal/campanha | Situação | Orçamento diário BRL |
|---|---|---:|
| Google 24318526983 — reparos/limpeza | Ativa | 29,20 |
| Google 24310102048 — instalação/pintura | Ativa | 30,80 |
| Google 24346726219 — cadastro de profissionais | Pausada | 1,00, sem entrega |
| Meta 52598343778388 — clientes, Facebook + Instagram | Ativa; anúncio editado e aprovado | 30,00 compartilhados |
| Meta 52591042341788 — profissionais | Ativa, objetivo separado | 30,00 |

- Google: nenhum aumento, nenhuma campanha reativada. Preservadas negativas existentes contra vagas, cursos, recrutamento e tutoriais. Grupo adicional de fogão/micro-ondas criado **pausado**, ID 205190718361, anúncio 829756818196, sem iniciar gasto adicional. Sua ativação aguarda validação da meta principal na conta.
- Meta: texto de clientes atualizado para a mensagem solicitada, preservando a campanha, o criativo e R$ 30/dia compartilhados entre Facebook e Instagram. `write_status=applied`; anúncio aprovado na leitura final. Campanha de profissionais preservada separadamente.
- Cobertura: confrontadas especialidades, coordenadas e raios com profissionais de perfil ativo, foto e saldo positivo ou Livre vigente. Na região circular de 30 km de São Paulo há ao menos um cadastro com cobertura integral para cada profissão dos grupos ativos; há 2 para geladeira e 2 para fogão/micro-ondas. Cadastro/raio não garante comparecimento ou disponibilidade em cada horário.
- O código de conversão coincide com o snippet de **Pedido publicado**, ação 7662297511: `AW-18273159663/RIX-CKfD1cUcEO-TqYlE`. O teste local prova disparo após persistência; **não confirma se a ação está como principal/biddable nem se a atribuição chegou ao Google**.
- Gastos, termos de pesquisa e CPA não puderam ser consultados: Supermetrics retornou `TRIAL_EXPIRED`, equipe 1165792, expiração 14/10/2026. Não foram inventados números ou termos de desperdício. Necessário restaurar a conexão paga para concluir auditoria de retorno e meta principal. Nenhuma assinatura foi contratada.

## Dinheiro e Efí

- A assinatura Livre tem checkout e conciliação implementados; testes isolados passaram. Nenhuma cobrança real nem transferência foi executada nesta missão.
- Pagamento integral pós-serviço com repasse de 87% para qualquer banco **continua indisponível**. Configuração atual: `habilitado=false`, `homologado=false`; zero pagamentos pós-serviço registrados.
- PR #147 segue rascunho, separada desta publicação: reforçados comprovantes, rejeição de devolução, reserva global do envio, idempotência e integração ao cadastro Pix da PR #148. Testes de reconciliação reais em PostgreSQL local passam sem duplicidade. Migrações e função de repasse dessa PR não foram aplicadas em produção.
- Pendências de banco: comprovar liberação de `pix.send` e `gn.pix.send.read`; webhook associado à chave pagadora; homologação de envio/consulta, titularidade, rejeições, timeout/retry e limites; confirmar tabela de tarifas e saldo para custeá-las.
- Pendências técnicas antes de ativar a PR #147: implantar e testar webhook autenticado que reconsulta o banco; reconciliação contínua de estornos posteriores à liquidação; políticas/fluxo administrativo para devolução, falhas permanentes e tarifas; prova de notificações separadas em aparelhos reais; testes bancários controlados. Bloqueios adicionais de webhook/limites/tarifas permanecem falsos por padrão.

Não considerar a missão integralmente concluída: faltam homologação bancária, validação autenticada das jornadas de produção e auditoria completa dos anúncios.

## Publicação comprovada

PR #149 incorporada, commit `d7fedbe9c5bcddc1ac2c1f4327890263513a396c`. Deploy de produção `dpl_5X325nPqaeKuGyBy37oZm8RB3hEw` READY. Domínio oficial e preview devolveram os arquivos de Carteira, painel e Service Worker idênticos ao build testado. Ajuste final de legibilidade das tabelas e busca por nome do profissional validado nesta sequência.
