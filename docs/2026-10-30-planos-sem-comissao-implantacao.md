# Quem Faz — implantação de planos sem comissão e visita paga (30/10/2026)

## Situação e referência
- Fonte das regras: `prompt-planos-quemfaz.md` fornecido pelo responsável.
- Backup imutável de referência: commit `c1c7a2be2e642cc38f6fa3756b444b0ed6425c74`, branch `backup/antes-planos-sem-comissao-20261030`.
- Não modificar Google Ads, Meta Ads nem bloco publicitário da home.
- Não instalar novos pagamentos ou cobrança de visita sem autorização dos pontos pendentes.
- Os valores e limites de Básico, Pro e Completo desta fase são propostas, **não autorizados para venda**.
- Estruturas novas ficam somente nesta branch e feature flag **desligada**.

## Achados verificados na operação
- `private.qf_comissao13_config.ativo = true` em 30/10/2026. Há cobranças e regras antigas no backend e frontend.
- `public.qf_livre_assinaturas`: 8 assinaturas registradas, 8 vigentes na consulta. Não cancelar ou alterar esses períodos.
- `public.qf_planos_profissional`: 1 pacote do catálogo anterior vigente (mensal), preservá-lo.
- O catálogo público antigo ainda tem `livre` por R$39,90 e `mensal`/ `pro`/ `premium` legados; a migração v2 não os altera.
- `private.qf_livre_desbloquear` atualmente grava `qf_desbloqueios.origem='comissao13'` e termos de adesão.
- `public.qf_desbloquear_chamado` já usa a cota antiga antes do saldo avulso, com alterações e débitos numa transação. Novos planos devem preservar esse padrão atômico.
- `qf_livre_assinaturas` e `qf_planos_profissional` são caminhos diferentes de benefícios; implementar apenas um seria incorreto.
- Preservar bônus de indicação de R$10; não criar bônus de cadastro, teste ou nova cortesia.
- A Efí oferece Pix para envio via API, mas necessita `pix.send`, webhook e limites liberados para a conta. Não foi confirmada autorização desta conta nem política de tarifas.

## Correção final do fluxo de cadastro — 30/10/2026
**Valor correto do Avulso: R$ 13,00 (não R$ 3,00).**
O novo profissional deve escolher um plano e pagar **somente o preço daquele plano** para finalizar seu cadastro. Sem Pix liquidado e conciliado no servidor, o pré-cadastro pode ficar pendente, mas não pode haver perfil profissional ativo, nem acesso a desbloqueios.
- Avulso: recarga inicial mínima R$ 13,00; os R$ 13,00 vão integralmente para saldo de desbloqueios após Pix confirmado.
- Básico: R$ 39,90, libera a cota do Básico após Pix confirmado. **Não cobrar R$ 13 adicionais.**
- Pro: R$ 79,90, libera a cota do Pro após Pix confirmado. **Não cobrar R$ 13 adicionais.**
- Mensal completo: R$ 149,90, libera a cota do Mensal completo após Pix confirmado. **Não cobrar R$ 13 adicionais.**
- O pré-cadastro necessário para emitir Pix não equivale a cadastro ativo. Somente o servidor, após validar titularidade, valor, status, TXID/E2E e idempotência, pode ativar perfil e crédito/cota.
- Profissionais já ativos com direitos pagos não podem ser desativados retroativamente por essa nova regra.
- Esta mudança não altera os pontos ainda pendentes do fluxo de taxa de visita.
 
## Regra de pagamento antecipado confirmada em 30/10/2026
- **Todos** os planos exigem pagamento antes de liberar o benefício, inclusive Avulso.
- Avulso é o plano de recarga inicial mínima de R$ 13,00: até o Pix confirmado, o cadastro continua pendente e sem desbloqueios.
- Os R$13 (ou o valor maior escolhido) são creditados somente após confirmação bancária no servidor; cobrança criada, Pix apenas gerado, Pix pendente, recusado, cancelado ou não conciliado não geram nenhum crédito.
- O crédito liberado pode então ser consumido conforme o preço de cada desbloqueio. Uma recarga paga não deve ser contabilizada duas vezes.
- Básico, Pro e Mensal completo exigem Pix confirmado para ativar suas cotas. Se cota acabar, desbloqueio só com saldo de crédito de origem confirmada; sem ambos, bloquear e oferecer recarga.
- Não conceder bônus inicial de cadastro, dois dias grátis nem cortesia. Preservar bônus de indicação conforme política já existente, sem confundir com pagamento inicial do Avulso.
- Não eliminar saldos antigos efetivamente pagos ou direitos de assinaturas antigas vigentes.
- As regras novas ainda estão apenas numa branch **inativa** e não habilitam cobrança em produção. Ao implementar RPC real, verificar `qf_recargas.status='aprovado'`, valor, TXID/E2E, identidade e unicidade antes de registrar crédito.
 
## Código de confirmação: NÃO remover
`qf_comissao13_codigo_criar` e `qf_comissao13_cliente_confirmar` fazem mais do que comissão: validam a posse do contato por código, registram aceite da contratação, conclusão e contestação, impedem certas contratações conflitantes e registram eventos. Há também código de seis dígitos fixo do pedido, usado para outros fluxos. Antes de remover qualquer um, separar essas funções da lógica financeira e preservar a prova de consentimento do cliente. Portanto o código fica intocado nesta etapa.

## Primeira fase entregue na branch
1. `qf-planos-v2.js`: prévia pura e inativa de cotas, crédito avulso, período pago, consumo justo de 100 e preservação do legado. Não dá permissão para desbloquear nem executa pagamento.
2. `20261030183500_planos_visitas_v2_preparacao_inerte.sql`: estrutura isolada de catálogo proposto, contratos pagos, contador transacional único, visita paga e conciliação; `private` + RLS, sem grants a `anon`/`authenticated`. Todos os checkouts e visitas permanecem explicitamente desativados.
3. Testes de cotas, confirmação de pagamento, expiração, legado, fallback, segurança de configuração e ausência de alteração do histórico antigo.

## Sequência obrigatória antes de ativar
1. Obter confirmação de preços/limites finais de Básico, Pro e Mensal completo.
2. Definir se o Pedido Urgente R$9,90 continua, e quem paga as tarifas de recebimento e envio Efí.
3. Verificar na conta Efí os escopos Pix, cadastro do webhook, titularidade validável, limites e devoluções.
4. Implementar RPC do servidor para consumo de cota e recarga sob bloqueio transacional, com Pix confirmado, idempotência e migração de contratos legados.
5. Desativar todas as fontes de comissão **no backend**, não apenas na interface. Preservar histórico e os controles de contratação/contestação que têm outra finalidade. Atualizar telas e comunicação apenas depois de impedir cobrança.
6. Cancelar novas ofertas de teste/cortesia, preservar bônus de indicação, e impedir novas compras do plano antigo. Não prejudicar períodos já pagos.
7. Implementar checkout Efí de recargas e planos, conciliar por `txid`/`endToEndId` e conferir saldo na mesma transação que dá a cota.
8. Implementar cobrança de visita opcional, seleção de profissional e vínculo Pix, confirmação do cliente/48h, lançamento de repasse ou devolução e painel de auditoria. Sem envio automático até escopo/limites/tributos conferidos.
9. Validar com dados de teste controlados (não criar cobranças reais sem autorização), Android e desktop; teste de regressão do visitante, cliente logado e profissional.
10. Somente após aprovação final dos pontos abertos: migrar, liberar as flags de modo seguro, publicar, conferir no domínio real e executar rollback se necessário.

## Pendências que o arquivo explicitamente exige confirmar
- Mensal completo: preço final R$149,90 e limite de 100/mês;
- Básico: 10/mês; Pro: 25/mês;
- manter ou remover urgência R$9,90;
- pagador das tarifas Efí no Pix de visita;
- capacidade efetiva da conta Efí para `pix.send` e processo alternativo manual;
- confirmar se alguma função de confirmação pode ser removida (auditoria indica que NÃO, por ter outras funções).

## Rollback
As fases desta branch não modificam produção. Para uma implantação futura, manter o checkout novo desligado, reapontar Vercel para o commit estável da referência e reverter apenas alterações do novo catálogo/rotas por migrations compensatórias. Nunca truncar registros de contratos, pagamentos ou histórico.
