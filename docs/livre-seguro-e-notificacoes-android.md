# Correção restrita: Quem Faz Livre e ícone de notificações

## Aprovação administrativa

O banco já possuía geração automática da comissão. A mensagem “13% se contratar, após aprovação do admin” permanecia em `qf-admin-valor.js`, e outra menção à aprovação administrativa permanecia na lista de assinantes do painel. Ambas foram corrigidas.

Esta missão solicita expressamente código de segurança, retomando a validação por código que havia sido retirada na versão anterior. O cliente vê o código do próprio pedido somente no acesso protegido do navegador original ou no chat autenticado como titular. O código não é devolvido ao profissional. Para confirmar, o cliente informa os seis dígitos e declara a contratação, o valor e a conclusão. O servidor valida autenticação/propriedade, código, limite de tentativas, valor, estado do pedido e exclusividade do contratado.

Após confirmação válida, gera 13%, registra a conclusão e cria uma única entrada na fila Pix. A emissão e a conciliação continuam na rotina Efí existente, ativa a cada minuto. O vencimento permanece em 48 horas; o bloqueio continua condicionado à comissão vencida. Pagamento não é confirmado pela tela ou pelo ADM. Não há aprovação retroativa em massa.

Os controles de aprovação comuns foram retirados das linhas sem divergência. O ADM pode registrar contestação/suspeita de fraude e resolver casos contestados ou divergentes, mediante registro. O backend recusa aprovação administrativa no fluxo normal e impede reaprovar uma cobrança existente.

## PWA, Web Push e FCM

O Service Worker e a notificação local usavam `icon.svg`, um logotipo com fundo opaco, como badge da barra de status. Foi substituído por `assets/notifications/quemfaz-badge-96.png`, branco e transparente, derivado da silhueta oficial QF. O logotipo colorido continua como ícone grande.

Recursos Android preparados em `android-notification-fix`: VectorDrawable de 24dp, PNG nas cinco densidades, metadado Firebase e instrução para `setSmallIcon`. O FCM passa a indicar o recurso local `ic_stat_quemfaz`; mensagens data-only levam a mesma indicação para o serviço nativo. O deploy do push preserva o código que já estava em produção, inclusive comportamento de chat e horários; não muda canais, destinatários ou regras de disponibilidade.

Não foi localizado o projeto Android Quem Faz em repositórios ou arquivos acessíveis. Portanto, não há AAB compilado/assinado nem atualização da Play Store nesta entrega. O kit precisa ser integrado ao projeto oficial, ter versão incrementada a partir da versão real, ser compilado/assinado e testado no aparelho. O backend ou o site não conseguem substituir um recurso drawable dentro de um APK já instalado. Não foi feito teste em Android físico/emulador.

## Verificação

- Build 12.1.34 aprovado.
- Testes em Postgres descartável: código incorreto, ausência de conclusão, tentativas limitadas, propriedade, valor divergente, Pix único, 48 horas, bloqueio no vencimento e liberação após pagamento.
- Componentes reais em JSDOM: cliente confirma pelo acompanhamento e pelo chat com código e conclusão; profissional não recebe o código.
- Service Worker executado em sandbox: badge correto, preservação de título/destino e opções.
- PNGs: dimensões 24/36/48/72/96, branco, canal alfa, cantos transparentes e silhueta não retangular.
- FCM executado com HTTP simulado: recurso local nas mensagens e orientação ao serviço data-only, sem disparo para usuários reais.
- Não foi criado pagamento real de teste. As falhas antigas da suíte geral são registradas separadamente; não significam que todos os testes do repositório passaram.
