# Pedido simplificado em quatro etapas — revisão em branch

## Estado recuperado

A branch `feat/pedido-simplificado-4-etapas` não existia no GitHub na consulta inicial (pesquisa sem resultado e leitura da referência retornando 404). O diretório inicial desta sessão não continha o checkout nem alterações recuperáveis. Portanto, nenhuma edição anterior dessa branch foi presumida salva.

A implementação aproveitada está efetivamente na `main`, pelo PR #103, commit `0c7b32c584700e4f0405c9c8dd695da09be89073`. A nova branch parte exatamente desse commit; não reimplementa pagamentos, distribuição, notificações ou administração.

## Resultado

1. Serviço, detalhes e escopo adaptados à profissão.
2. Cidade, UF, bairro, prazo, data e disponibilidade.
3. Materiais quando pertinentes e orçamento por faixa, incluindo “Preciso de uma avaliação”.
4. Resumo expansível, nome, telefone, intenção, modalidade, qualificação adicional do Garante e consentimento.

Não há valor exato obrigatório. Faixas ficam registradas nas respostas privadas e na descrição pública do serviço, sem transformar o limite da faixa em preço exato. A opção de avaliação tem valor numérico nulo. O tradicional aceita avaliação; o Garante exige faixa definida, intenção de contratar, materiais definidos e confirmação adicional. A cobrança permanece 4× e a exclusividade permanece para um profissional.

Nome e telefone ficam privados. Nenhum dado pessoal é acrescentado à descrição. Chave idempotente, fingerprint, locks e integração de criação permanecem no mesmo endpoint `qf_publicar_atendimento`. Retry após timeout mantém o mesmo usuário e a mesma chave. Botões e campos ficam bloqueados durante o envio.

A prévia profissional mostra serviço, escopo, materiais, disponibilidade, faixa/avaliação, data e local. A taxa Garante passa a aparecer em 4× também no resumo superior, corrigindo sua divergência com o botão. A regra financeira não foi alterada.

## Arquivos realmente alterados

| Arquivo | Alteração |
|---|---|
| `qf-atendimento.js` | Quatro etapas, faixas por grupo de profissões, avaliação sem preço, validação, revisão, consentimento e retry. |
| `index.html` | Referência do módulo v2 e consistência da taxa Garante no resumo profissional. Patch pontual; 1.264.513 → 1.264.646 bytes. |
| `admin.html` | Somente referência do módulo v2. |
| `sw.js` | Somente referência do módulo v2 no cache. |
| `supabase/migrations/20261022025533_pedido_simplificado_faixas.sql` | Substituição compatível da RPC de publicação, validação de faixa/prazo e descrição pública canônica; sem alterar funções de desbloqueio, tabelas, saldos ou pedidos antigos. |
| `tests/atendimento.test.cjs` | Testes adaptados e novos cenários de faixas, avaliação, prazo, privacidade e deduplicação. |
| `tests/helpers/atendimento-db.cjs` | Aplica a nova migração na fixture isolada. |
| `tests/atendimento.browser.cjs` | Duas modalidades em quatro etapas; contato protegido, consentimento negado, timeout após gravação, duplo clique/retry e prévia profissional. |
| `tests/atendimento.supabase.browser.cjs` | Roteiro de homologação adaptado às quatro etapas. Não executado contra Supabase nesta sessão. |
| `.github/workflows/atendimento-ci.yml` | Inclui a branch separada no gatilho dos testes existentes. |
| `docs/mockup-pedido-4-etapas.html` | Mockup com capturas reais do teste local, dados e datas fictícios; faixas visíveis para revisão. |
| `docs/mockup-pedido-4-etapas.png` | Visão geral renderizada do mockup. |
| `docs/pedido-simplificado-validacao.md` | Este relatório. |

## Testes executados nesta sessão

- `npm ci --ignore-scripts --fetch-retries=0 --fetch-timeout=20000`: aprovado. npm 11.9.0 e Node 24.19.0 disponíveis.
- `node --check qf-atendimento.js`: aprovado.
- `npm test`: build aprovado; **253 testes contabilizados, 251 aprovados, zero falhas e 2 opcionais ignorados**.
- `QF_CHROMIUM_EXECUTABLE=/tmp/chromium npm run test:atendimento:browser`: aprovado com Chromium local 153 e viewport móvel 390×844, usando aplicação compilada, createCall real, HTTP local e banco PGlite isolado. Todos os destinos externos bloqueados.
- O navegador verificou as quatro etapas; perguntas adaptadas; faixa Garante; publicação, débito 4× e segundo desbloqueio recusado; prévia sem nome/telefone e com valor coerente; fluxo do cliente autenticado; avaliação no tradicional; consentimento negado sem envio; timeout após commit; mesma chave no retry; duplo clique e um único evento de criação por pedido.
- SQL executado no PGlite: compatibilidade com payload numérico anterior, faixas/avaliação, campos inválidos, data, consentimento, acesso privado antes do desbloqueio, autorização de titular/admin, até quatro tradicionais, Garante exclusivo, preço 4×, preservação de plano e legado, ausência de novo evento em retry e rejeição de alteração de condições no pedido duplicado.
- `git diff --check`: aprovado. Mockup renderizado e inspecionado.

## Testes não comprovados neste ambiente

**Nenhum teste bloqueado por indisponibilidade do npm.** O instalador padrão do Playwright baixou um ZIP inválido; o teste foi executado com Chromium local alternativo, instalado fora do projeto. Nenhuma dependência desse navegador foi adicionada ao pacote do app.

- `npm run test:atendimento:postgres`: bloqueado pela ausência de `QF_TEST_DATABASE_URL` e de um PostgreSQL descartável configurado. A validação SQL em PGlite não substitui corrida entre conexões reais. O workflow existente executa este teste em PostgreSQL 17 no CI.
- Teste opcional de pagamentos em PostgreSQL: ignorado por ausência de `QF_TEST_PG`/banco local. Regressões restantes de pagamentos estão entre os testes aprovados; não houve transação real nem webhook bancário externo.
- `npm run test:atendimento:supabase`: bloqueado pela ausência de `QF_STAGING_CONFIG` apontando para Supabase descartável. Sem essa homologação não se afirma validação completa de Auth, PostgREST, Edge Functions ou schema real.
- Teste opcional de abertura do PDF por qpdf: ignorado porque qpdf não está instalado.
- Push em aparelho físico, entrega real de notificações e cobranças reais não foram executados.

## Liberação pendente

Trabalho salvo somente em branch separada. Nenhuma migração foi aplicada a produção; nenhuma alteração foi integrada à main e nenhum deploy de produção foi solicitado.

Antes de integrar, exigir aprovação do usuário, resultado do CI com concorrência/pagamentos e homologação completa em ambiente separado. Verificar eventual drift da definição da RPC antes de aplicar. A migração preserva os payloads anteriores e deve preceder a liberação do módulo v2: publicar o frontend sem ela perderia a faixa no Tradicional e recusaria Garante com faixa. Não fazer esse corte parcial.

A confirmação de interesse é declaração do cliente, não garantia de contratação. Não se declara funcionamento integral em produção com base em fixtures locais.
