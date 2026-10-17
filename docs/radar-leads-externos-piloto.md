# Radar de Leads Externos — Grande ABC

## Objetivo
Localizar pessoas que procuram um serviço **fora** do Quem Faz, convidá-las a publicar o pedido de graça e, se (e só se) elas publicarem, deixar o pedido seguir o fluxo normal: profissionais compatíveis desbloqueiam com os créditos de sempre. O radar **não** cria pedidos, **não** notifica profissionais e **não** cobra nada a partir de uma publicação externa.

## Como funciona
1. **Captura** (`scripts/radar-leads-run.cjs`, a cada 3 h via GitHub Actions): lê só fontes habilitadas em `qf_lead_sources` (API/feed público e documentado), respeitando o intervalo mínimo de cada fonte. Qualquer bloqueio (401/403/429/5xx) interrompe a fonte naquela rodada e fica registrado; não há nova tentativa nem contorno.
2. **Classificação** (`qf-radar-classifier.js`, mesma regra no servidor e no painel): serviço, cidade/bairro do Grande ABC, intenção (procura × oferta), urgência, confiança. Ofertas de serviço, textos sem pedido e cidades fora da região são descartados e não são gravados.
3. **Minimização**: o trecho guardado passa por remoção de telefone, e-mail, CPF e @usuário (no executor **e** de novo no banco). Nenhum nome ou perfil é salvo; o link da publicação é a origem.
4. **Staging** (`qf_leads_externos`, `qf_lead_events`): deduplicação por (fonte, URL) e por conteúdo; histórico de eventos; validade de 30 dias.
5. **Painel** (`/admin.html` → *Radar de Leads Externos*): indicadores, fontes, lista com filtros, histórico, registro manual e preparação de convite.
6. **Convite**: gera link rastreável `https://quemfazservico.com.br/?servico=<serviço>&utm_source=radar&utm_medium=convite&utm_campaign=radar_abc_<serviço>&utm_content=<token>`. O painel **só prepara** a mensagem; o envio é manual (copiar e enviar pelo canal permitido) e depois se marca “enviado”. Não existe envio automático porque nenhum canal com permissão foi configurado.
7. **Conversão**: o link abre o formulário existente (o serviço já vem selecionado). Quando o cliente publica, o formulário grava `utm_source=radar` e o token em `qf_chamados.marketing_origem`; `private.qf_radar_sync_pedidos()` (a cada 10 min e ao abrir o painel) apenas **lê** essa origem e liga o lead ao pedido. A distribuição, o raio, o horário, o limite de profissionais e o desbloqueio com créditos são exatamente os de qualquer outro pedido.

## Fontes
| Tipo | Situação |
|---|---|
| `manual` (administrador registra uma publicação pública que encontrou) | Ativa |
| `bluesky` (busca pública oficial; senha de app opcional) | Conector pronto, **desabilitado** até haver autorização registrada |
| `mastodon` (hashtags públicas da instância) | Conector pronto, **desabilitado** |
| `rss` (feed de um site que permita a coleta) | Conector pronto, **desabilitado** |
| Facebook (grupos/Marketplace), Instagram, OLX, WhatsApp, Nextdoor, Google | **Não conectados**: sem API/permissão para coleta; não serão contornados |

Habilitar uma fonte exige prova de autorização (o banco recusa sem ela):

```sql
insert into public.qf_lead_sources (id, label, kind, config, allowed_host, authorization_note, terms_url, enabled)
values ('bluesky_abc', 'Bluesky · busca pública', 'bluesky',
        '{"queries":["preciso de pintor Santo André","procuro eletricista São Bernardo"],"lang":"pt","limit":25}',
        'bsky.app', 'API pública oficial (app.bsky.feed.searchPosts); termos conferidos em <data> por <quem>.',
        'https://bsky.social/about/support/tos', true);
```

Segredos do executor (GitHub → Settings → Secrets): `RADAR_SUPABASE_URL`, `RADAR_SUPABASE_SERVICE_ROLE_KEY` e, opcionalmente, `RADAR_BSKY_HANDLE` / `RADAR_BSKY_APP_PASSWORD`. Sem eles o job termina sem coletar nada.

## Indicadores do painel
- **Leads encontrados**: oportunidades reais (testes e duplicados ficam de fora).
- **Qualificados**: confiança ≥ 70% ou revisados por um administrador, ainda não descartados.
- **Convites enviados**: marcados como enviados pelo administrador.
- **Clientes confirmados**: o cliente publicou pelo link **ou** o administrador marcou “cliente confirmou”.
- **Pedidos publicados**: pedidos em `qf_chamados` cuja origem é o token do convite.
- **Profissionais que desbloquearam / créditos usados**: desbloqueios ativos desses pedidos (`qf_desbloqueios`).
- **Recargas atribuíveis**: recargas aprovadas de profissionais que desbloquearam um pedido do radar, feitas **depois** do primeiro desbloqueio desse tipo (atribuição por proximidade, não prova de causa).

## Segurança e LGPD
- RLS ligada e fechada para `anon`/`authenticated` nas quatro tabelas; acesso só por funções `qf_radar_*`, as do painel exigem `private.qf_is_admin()`, as de ingestão são exclusivas do `service_role`.
- Base legal registrada por lead (`legitimo_interesse`), sem consentimento presumido (`consent_status = nao_verificado`).
- **Retenção**: lead sem pedido é apagado em 30 dias; lead que virou pedido é anonimizado (trecho e URL removidos) após 180 dias; registros de teste somem em 7 dias (rotina diária `qf-radar-manutencao`).
- **Exclusão / opt-out**: botões no painel removem o lead e o histórico e guardam apenas o hash da URL em `qf_lead_supressao` para não recapturar.
- Registros de teste (`is_test`) ficam fora dos indicadores e usam domínios `.invalid`.

## Validação
- `node --test tests/radar-leads-*.test.cjs` — classificador, conectores (sem rede), executor, segurança estática e tela.
- `docs/validation/radar-leads-externos-sql-test.sql` — teste de integração no banco dentro de uma transação que sempre é revertida (ingestão, deduplicação, redação, convite, vínculo ao pedido, desbloqueio/recarga, LGPD, retenção, acessos negados).
