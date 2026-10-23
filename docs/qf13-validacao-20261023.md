# Quem Faz Livre e comissão 13% — 23/10/2026

## Fluxo final aprovado

- Cada pedido novo recebe um código de contratação aleatório de seis dígitos.
- Na publicação, uma chave privada de 256 bits do navegador é vinculada atomicamente ao pedido. Somente seu hash fica no banco; ela é removida das respostas e nunca é retornada nas APIs de profissionais ou administradores.
- O acompanhamento mostra novamente o código ao navegador que publicou, inclusive sem sessão de conta. O cliente não precisa criar uma conta, receber SMS nem abrir link de WhatsApp.
- O código de contratação é diferente da chave privada de acompanhamento. Conhecer o código não permite acessar o acompanhamento ou responder pelo cliente.
- O cliente fornece os seis dígitos ao profissional somente ao contratar. O profissional informa código e valor na própria tela do pedido.
- A comissão de 13% só é gerada pela aprovação manual do administrador, com evidência registrada.
- Se o profissional disser que não fechou, o acompanhamento oferece confirmação ou contestação. Divergência não cobra nem suspende automaticamente; permanece para decisão administrativa.
- Gratuito, Livre e Avulso respeitam bloqueio por prestação vencida. Uma única prorrogação adicional de 48 horas é permitida.
- Carteira compacta, histórico recolhido e três ofertas comerciais atuais. Assinaturas antigas e registros financeiros preservados.

## Evidências

- `tests/acompanhamento-codigo.test.cjs`: publicação pelo SQL real da aplicação, idempotência, ausência da chave privada nos dados expostos, acesso anônimo protegido, código correto/incorreto, divergência e auditoria.
- O mesmo teste executa os componentes reais de publicação, acompanhamento, profissional e administrador com DOM e banco descartável integrados: código exibido ao cliente, oculto ao profissional antes de fornecido, envio de valor e código, comissão R$65 sobre R$500 somente após clique de aprovação administrativa.
- `tests/comissao13-live-rollback.sql`: executado no Supabase de produção com identidades sintéticas e transação revertida; inclui publicação real, três modalidades, limite de quatro, propriedade do pedido, código, bloqueio Livre/Avulso, prorrogação única, regularização, divergência e auditoria. Sem COMMIT, sem cobrança e sem envio pela fila pg_net.
- Testes de Pix Efí usam respostas simuladas para conferir titular, valor, txid, rejeições e ativação por confirmação do servidor, sem emitir cobrança real.

- `tests/acompanhamento-codigo.browser.cjs`: Chromium em 390 × 844 px, usando os arquivos do build e banco descartável. Publicação pelo formulário real, código no acompanhamento, inserção na tela do profissional, aprovação de R$65 sobre R$500 no painel e bloqueio em outro navegador. Nenhuma chamada externa permitida.

## Limites de acesso

A chave permanece no armazenamento do navegador original. Outro aparelho ou navegador, ou a limpeza dos dados do site, não concede acesso ao pedido pelo simples conhecimento do telefone ou do código compartilhado. A equipe deve conferir a propriedade antes de qualquer recuperação manual. Pedidos anteriores que não receberam essa chave preservam seus dados e códigos existentes; não são atribuídos automaticamente a outro navegador.

A bateria anterior à correção já apresentava três falhas de especificação em atendimento/Garante no commit ac11c92, reproduzidas em checkout separado. Não foi feita uma reconstrução desse fluxo; foi corrigida a compatibilidade da publicação com o formulário atual (data opcional e orçamento a combinar), necessária para publicar e mostrar o código.
