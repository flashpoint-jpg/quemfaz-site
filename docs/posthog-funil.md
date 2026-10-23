# PostHog — funil de clientes e profissionais (PROPOSTA, nada ativo em produção)

Estado verificado em 18/10/2026: o site **não** tem PostHog. Já existem: funil próprio (`qf_client_funnel`, 5.229 eventos, via `qf-client-acquisition.js`), GA4/Google Ads/Microsoft Ads (`qf-conversao.js`) e Meta Pixel.

## Regra para não duplicar
Nenhum tracker novo no navegador. O PostHog recebe os dados **dos mesmos registros do Supabase**, uma vez cada:

| Etapa do funil | Fonte única | Evento PostHog | `$insert_id` |
|---|---|---|---|
| Visitou / começou o formulário | `qf_client_funnel` (landing, home_submit, form_start, step_*_completed) | mesmo nome do `event` | `funnel:<id>` |
| Pedido publicado | `qf_chamados` (status ≠ aguardando_pagamento) | `pedido_publicado` | `chamado:<id>` |
| Desbloqueio (normal/exclusivo) | `qf_desbloqueios` (ativo) | `desbloqueio` (prop. `exclusivo`, `origem`) | `desb:<id>` |
| Recarga aprovada | `qf_recargas` (status = aprovado) | `recarga_aprovada` | `recarga:<id>` |

O evento `published` do `qf_client_funnel` **não** é enviado (já vem de `qf_chamados`). `distinct_id` = `session_id` (cliente anônimo) ou `profissional_id`; sem nome, telefone, descrição ou endereço. Reexportar o mesmo registro não duplica (mesmo `$insert_id`).

## Funis a criar no PostHog
1. Cliente: `landing → form_start → step_service_completed → pedido_publicado`.
2. Mercado: `pedido_publicado → desbloqueio` (conversão de pedido em contato) e `% de pedidos com 4 desbloqueios`.
3. Profissional: `recarga_aprovada → desbloqueio` (uso do crédito).
4. Quebra por `category`, `source`, `campaign`, `exclusivo`.

## Pendências (precisam do seu acesso)
- Login OAuth do plugin no PostHog (`/mcp` → `plugin:posthog:posthog`) e a chave/projeto do PostHog.
- Escolher o envio: exportação em lote do Supabase (recomendado, sem mexer no site) ou função agendada.
- Consentimento (LGPD): como nada novo roda no navegador, não há cookie novo.
