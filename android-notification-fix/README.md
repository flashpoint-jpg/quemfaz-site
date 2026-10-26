# Correção Android preparada para integração

Recursos derivados do símbolo oficial QF, em branco e transparente, com área de 24dp e PNGs de 24, 36, 48, 72 e 96px. O ícone colorido de abertura não é alterado.

1. Mesclar `app/src/main/res/` no módulo do aplicativo Quem Faz (`br.app.quemfaz`).
2. Mesclar o metadado Firebase fornecido no `<application>` existente.
3. Aplicar `setSmallIcon(R.drawable.ic_stat_quemfaz)` a todos os Builders: serviço FCM com payload data-only, exibição em primeiro plano, notificações locais e resumos de grupo. Não criar um segundo FirebaseMessagingService sem conferir o serviço já instalado.
4. Preservar canais, sons, permissões e comportamento existentes.
5. Incrementar o `versionCode` e `versionName` a partir da versão real do projeto. Gerar o AAB com a configuração e assinatura oficiais.
6. Conferir em aparelho Android: app aberto, segundo plano e encerrado, canais de chamados e avisos, resumo de grupo, temas claro e escuro. Confirmar ausência de notificação duplicada.

## Limite desta entrega

O código-fonte nativo, a configuração Gradle e a assinatura do aplicativo Quem Faz não estavam disponíveis nos repositórios ou arquivos acessíveis. Este diretório é um patch de integração, não um aplicativo novo nem um AAB compilado. A integração, compilação, assinatura, teste em aparelho e envio para a Play Store permanecem pendentes desses arquivos. Não usar o projeto Entrega Flash, que é outro aplicativo.
