# Auditoria das 20 falhas — 28/10/2026

## Referências e método

- Base anterior: `a334fe0ff44811a2c38ea66adc3599221ba80e04`.
- PR #152: head `376e4877476e8f40b1bc16f59195f85956390270`, merge/publicação `84a5fd8c281274c3df12daaced956c00db59c5f0`.
- CI original: Testar Funil Quem Faz, run `40742081403`, job `123006049895`; Atendimento obrigatório, run `40742081793`, job `123006051598`.
- Os dois jobs executaram a mesma suíte. O navegador foi ignorado após a falha de `npm test`; não eram 40 defeitos distintos.
- Reprodução local do merge: 399 testes, 377 passaram, 20 falharam, 2 ignorados.
- Execução completa da base anterior: 384 testes, 354 passaram, 28 falharam, 2 ignorados. Dezenove das vinte falhas já existiam. A base também contém divergência entre a versão fonte 12.1.38 e a versão produzida 12.1.45; essas falhas adicionais não foram atribuídas à PR #152.

## Matriz das vinte falhas originais

| # | Arquivo / teste original | Origem | Tratamento |
|---|---|---|---|
| 1 | acompanhamento-codigo / Publicação real encaminha ao acompanhamento | Base | Exercitar CEP, autenticação e publicação atual na index; preservar segredo privado e testar timeout após commit, retry e clique duplo sem duplicar evento. |
| 2 | atendimento / adapta perguntas e valida todas | Base | Fixture inclui consentimento explícito `aceite_app`; recusa de autorização continua testada. |
| 3 | atendimento / diarista não repete serviço | Base | Consentimento aparece antes dos detalhes; serviço pré-selecionado continua omitido. |
| 4 | atendimento / quatro etapas e faixas | Base | Fluxo atual não exige orçamento ou data; envia a combinar, valor nulo e modalidade tradicional. |
| 5 | aviso-online-horario / ajuste na home | Base | Verificar o controle atual no painel compacto da extensão, incluindo início/fim e ação de ajuste. |
| 6 | comissao13-current-ui / oferta antiga | Base | Comissão confirmada e vencida bloqueia; aguardar cliente não bloqueia. |
| 7 | comissao13 / frontend mostra bloqueio | Base | Oferta antiga encaminha ao Livre; não pode oferecer o antigo desbloqueio gratuito. |
| 8 | confirmacao-um-toque / tela real | Base | Tela atual exige valor, conclusão e código; declaração isolada não gera comissão. Regras históricas de backend continuam cobertas. |
| 9 | desbloqueio-exclusivo | Base | Texto atual preserva reserva para um profissional verificado; RPC, limites e regras financeiras mantidos. |
| 10 | garante-novos-intencao / novo Garante | Base | Formulário atual não promove pedidos; testes da migração histórica preservam o contrato SQL original. |
| 11 | garante-por-orcamento / orçamento define modalidade | Base | Mesma distinção entre formulário atual e migração histórica; autorização continua obrigatória. |
| 12 | interesse-cliente / selo antes do desbloqueio | Base | Verificar as duas chamadas atuais do selo e o módulo v6. |
| 13 | interesse-cliente / versão | Base | Igualdade fonte/SW e formato sem fixar a versão antiga 12.1.6. |
| 14 | livre-repasse-futuro / cadastro do Livre | PR #152: asserção antiga | O texto “Sem pagar por contato” saiu; a oferta atual diz “Sem cobrança por contato”. Mantidas as provas de repasse futuro indisponível. |
| 15 | negociacoes-ui / administrativo | Base | Cards substituem tabela. Orçamento de R$350 ainda em negociação mostra “Sem cobrança”; não se reconhece comissão antes da confirmação. Detalhe, privacidade e ausência de escrita mantidos. |
| 16 | orcamento-aproximado / index | Base | Módulo atual v6; validações e RPCs mantidos. |
| 17 | painel-menu-lateral | Base; outra asserção antiga exposta pela correção | Menu Financeiro e Pix, versão atual do módulo e cadastro Avulso/Livre. Catálogo Premium permanece histórico. |
| 18 | pedido-sem-prazo-profissional | Base | Extensão atual usa QFUrgencia diretamente; mantém ausência de prazo/data e regras de push. |
| 19 | publicacao-leve | Base | Clique antes do carregamento retoma uma vez o pedido na própria home, preservando os campos. |
| 20 | quemfaz-livre-preview / ativo e vencido | Base: defeito real | Restaurar estado ativo/vencido na oferta a partir do status fornecido pelo servidor. |

## Correções de produto e segurança

`qf-livre.js` ainda removia o cartão Livre, forçava/desmarcava o Avulso e substituía o aviso de saldo por texto legado. Removida essa interferência. Ambos os cartões, a escolha e os avisos de pagamento são preservados. Um teste DOM e um teste do artefato construído em 390/1280px verificam a correção. App/SW/cache atualizados juntos para 12.1.47.

Nenhuma função financeira, migração, credencial Efí ou dado de profissional foi alterado. Em leitura de produção: ambos os gatilhos de cadastro pago habilitados; funções de vínculo/resgate presentes; `private.qf_livre_split_config.habilitado=false` e `homologado=false`.

## Validação local

- `node scripts/build-client.cjs`: sucesso.
- `node --test --test-concurrency=4 tests/*.test.cjs`: 400 testes, 398 passaram, zero falhas, 2 ignorados (dependem de ferramentas opcionais). Inclui testes Efí simulados e cadastro obrigatório.
- `node tests/atendimento.browser.cjs`: fluxo atual construído + PostgreSQL isolado em 390/1280px: senha incorreta, recuperação, CEP, publicação, conversão única, chat, conclusão com código e links privados sem tags; cadastro Avulso/Livre nas duas larguras.
- `tests/cadastro-obrigatorio.postgres.sql` expandido e executado em PGlite isolado: bloqueio sem pagamento, legado, titularidade, R$13 de crédito único, Livre R$39,90/30 dias sem crédito adicional, KPIs privados.
- `git diff --check`: sucesso.

As integrações de navegador bloqueiam tráfego externo. Nenhuma cobrança real ou repasse foi feito. PGlite local não substitui o teste de concorrência multi-conexão PostgreSQL: essa etapa precisa passar no CI da nova PR. A homologação bancária de repasses permanece pendente e desligada.

Publicação e identificação dos commits finais serão registradas após CI e verificação da versão em produção; este documento não constitui confirmação antecipada de deploy.
