# ETAPA 6 — PATCH PARA REVISÃO (NÃO IMPLANTADO)

## Fatos
- Pagamento de R$ 14,99: 1 Pix pendente em 02/11/2026, 0 aprovados.
- Função `qf_resgatar_pre_cadastro(uuid,text)`: exige conta autenticada e perfil profissional.
- Função `qf_vincular_pre_cadastro(uuid,text)`: valida segredo e email confirmado, grava vínculo em tabela privada.
- `quemfaz-efi-notification` implantada retorna 410 (`pix_polling_active`); o pagamento depende de polling.
- Logs 02/11: 594 chamadas HTTP 500, 448 HTTP 200 na função sync; falhas 500 até ~10h03 BRT e sucesso depois. **A mensagem interna causal não foi confirmada**.
- A função sync não existia no GitHub main: incluída nesta branch a partir do código implantado, removendo token interno embutido.

## Segurança / comportamento
- O valor aprovado só pode vir da verificação da cobrança Efí no backend.
- A nova RPC é `service_role` exclusivamente, e opera transacionalmente em Postgres com `FOR UPDATE` + índices únicos.
- Não vincula pelo e-mail sozinho. Exige pagamento aprovado, email confirmado, vínculo prévio por segredo e perfil profissional válido. Não cria usuário Auth sem prova da posse.
- Sem conta, perfil ou vínculo: mantém o pagamento aprovado, anota `aguardando_identificacao` na tabela privada; não cria recarga/crédito.
- No retorno ao app, o fluxo atual precisa criar conta, confirmar email, vincular cobrança com segredo e criar perfil; a sincronização revisita aprovados não resgatados e conclui sem duplicar.
- Pagamentos históricos R$ 13,00 e pendentes não são elegíveis.
- A rotina de recarga aciona os triggers existentes do banco; o patch confere o crédito único para Avulso.

## Antes de qualquer deploy
1. Revisar no ambiente de homologação os triggers, RLS, auth e registros de produção.
2. Aplicar o patch SQL *somente no ambiente isolado*; atualizar Edge Function depois.
3. CONFIGURAR `QF_PIX_SYNC_INTERNAL_TOKEN` nas secrets e atualizar cron com o mesmo token. Token codificado anteriormente deve ser rotacionado; **não ficou no código da branch**. Sem esse ajuste, o cron responderá HTTP 403.
4. Verificar se a sincronização tem E2E, txid e valor confiáveis. Não aceitar resposta apenas do frontend.
5. Diagnosticar HTTP 500 pelo corpo de resposta interna e observabilidade segura; logs consultados não revelam o erro exato.
6. Não habilitar `quemfaz-efi-notification` sem autorização; ela foi intencionalmente desativada.

## Testes de integração obrigatórios EM HOMOLOGAÇÃO (nenhuma cobrança real)
| Caso | Esperado |
|---|---|
| Aprovado + usuário/profissional confirmado + vínculo válido | 1 recarga, 1 crédito e campos preenchidos |
| Aprovado + usuário inexistente | Estado aguardando_identificacao; sem crédito |
| Usuário volta, cria perfil e vincula com segredo | 1 recarga e 1 crédito após reconciliação |
| Chamar rotina duas vezes e em paralelo | Nada duplicado |
| Pix pendente | Nada alterado |
| Pix antigo de R$ 13,00 | Nada alterado |
| Recarga falha no trigger | Rollback transacional, pagamento aprovado preservado |
| Token cron inválido | HTTP 403 sem executar sincronização |
| Não há vínculo e só e-mail coincide | Nunca liberar o saldo |

## Limitação de produto
Se o usuário nunca criar Auth e perfil, não há dados suficientes para finalizar todo o cadastro profissional. O pagamento aprovado é preservado e exige identificação posterior (sem perda da cobrança).

## Implantação
Somente branch. Não fazer merge, aplicar SQL em produção ou implantar Edge Function sem autorização.
