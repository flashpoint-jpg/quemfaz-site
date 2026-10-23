# Roleta Quem Faz — Desbloqueou, Ganhou!

Status: proposta aprovada visualmente; **não habilitar em produção sem implementação e testes**.

## Mecânica do piloto
- Um desbloqueio efetivamente pago e não estornado concede um giro.
- Cada giro revela um desconto **fixo e garantido de R$ 3**, sem aleatoriedade, e não dinheiro.
- O desconto é aplicado no próximo desbloqueio elegível, limitado ao preço cobrado, uma unidade por compra, sem saque ou transferência.
- Validade: sete dias após concessão. Piloto de quinze dias, com teto de custo promocional configurável no admin.
- Pagamento com saldo de carteira pode ser elegível desde que seja débito efetivo; créditos promocionais não geram giros por si só.
- A interface deve informar previamente que o resultado é garantido e que a roleta é apenas animação.

## Interfaces
1. Card do pedido: "Desbloqueie e ganhe 1 giro na Roleta Quem Faz".
2. Confirmação: mostrar valor, desconto aplicado e aviso do novo giro, sem prometer antes da confirmação.
3. Pós-pagamento: contato liberado e CTA "Girar agora".
4. Roleta azul/laranja, seis setores idênticos de R$ 3, animação curta, acessível e respeitando redução de movimento.
5. Resultado: "Você ganhou R$ 3 de desconto", data de validade e CTA "Ver pedidos".
6. Carteira: saldo financeiro separado de giros pendentes e descontos promocionais; extrato e validade.
7. Admin: liga/desliga, teto de orçamento, concedidos, consumidos, expirados, estornos, custo, conversão e trilha de auditoria.

## Segurança e integridade
- Gerar giro no backend apenas após transação confirmada e identificador único do desbloqueio.
- UNIQUE(unlock_id) no registro de giros; callbacks de pagamento idempotentes.
- Concessão, consumo e débito de desconto em transações atômicas com bloqueio adequado.
- RLS: profissional só lê os próprios registros; mutações financeiras apenas por função de serviço autorizada.
- Registrar IDs de profissional, pedido, desbloqueio, pagamento, giro e benefício; timestamps, motivo e origem.
- Validar limites no servidor, inclusive em chamadas simultâneas; nunca confiar em estado do navegador.
- Reversão de pagamentos cancela benefícios não consumidos; benefícios já usados requerem conciliação, sem saldo negativo automático.
- Preservar histórico ao pausar campanha; jamais apagar créditos financeiros existentes.
- LGPD: minimizar dados pessoais nos registros de promoção e limitar acesso administrativo.

## Testes de aceite
- Pagamento pendente/falho não gera giro.
- Callback duplicado não gera segundo giro.
- Desbloqueio real com saldo próprio gera no máximo um giro.
- Dois cliques simultâneos não consomem o mesmo giro duas vezes.
- Desconto aplicado uma única vez e limitado ao valor do desbloqueio.
- Desconto expirado não é aceito.
- Estorno e cancelamento tratados sem inconsistência contábil.
- Teto orçamentário impede novas concessões, mas preserva benefícios já prometidos.
- Compatibilidade com fluxo atual de desbloqueio e carteira, sem alterar limite de quatro profissionais por pedido.

## Implantação
Antes de qualquer merge/deploy: localizar fluxo real de pagamentos/desbloqueios e esquema de carteira, implementar migrations e funções, revisar impacto jurídico da promoção, rodar build/testes e validar em ambiente de teste. Ativar com feature flag desligada inicialmente; publicar apenas com aprovação das verificações.
