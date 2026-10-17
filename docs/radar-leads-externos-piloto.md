# Radar de Leads Externos — piloto Grande ABC

## Objetivo
Localizar oportunidades reais de contratação fora do Quem Faz e converter interessados em pedidos confirmados, sem criar chamados falsos nem cobrar créditos por leads não confirmados.

## Fontes
Usar apenas APIs, feeds, sites e comunidades com acesso e coleta autorizados. Nunca contornar login, CAPTCHA, bloqueios, restrições de plataformas ou coletar telefones privados. Facebook e OLX exigem verificação de permissões antes de qualquer integração; buscas do Google não fornecem contatos pessoais.

## Pipeline
1. Conector autorizado recebe URL, texto público permitido, data, origem e localização aproximada.
2. Valida política da fonte, deduplica por hash de URL + texto, classifica intenção, serviço, cidade e confiança.
3. Salva oportunidade em tabela privada de staging, com origem, URL, status, horário, base legal, retenção e trilha de auditoria.
4. Painel admin exibe novos, revisados, convite permitido, convite enviado, confirmado, convertido e descartado. Não expor dados pessoais a profissionais.
5. Preparar resposta/convite com link rastreável. Envio automático somente se API/canal e consentimento ou outra base legal adequada permitirem. Caso contrário, revisão e envio manual.
6. Cliente abre o link e confirma dados e vontade de publicar, pelo formulário existente.
7. Apenas após criação bem-sucedida de qf_chamados, associar lead externo ao ID do pedido e usar distribuição normal por profissão, raio e horário.
8. Acompanhar convite -> clique -> publicação -> desbloqueio, sem alterar preços, carteiras, bônus ou limite de 4 contatos.

## Implementação técnica proposta
- Migração aditiva: qf_leads_externos (id, source, source_url, source_item_id, service, city, neighborhood, excerpt, classification, confidence, status, first_seen_at, last_seen_at, expires_at, consent_status, confirmed_chamado_id, metadata), qf_lead_events e qf_lead_sources.
- RLS habilitada e sem acesso anon/authenticated por padrão; acesso administrativo somente por backend autenticado e autorização validada no servidor. Segredos exclusivamente server-side.
- Ingestão idempotente com rate limiting, retry, logs, controle de exclusão/retention, opt-out e respeito à LGPD.
- Job periódico configurável; sem conectores fictícios nem leads simulados misturados aos reais.
- Painel /admin.html: aba Radar de Leads com filtros, link original, fonte, classificação, histórico e métricas.
- Testes: ingestão duplicada, origem não autorizada, cliente não confirmado, privacidade/RLS, conversão confirmada, vínculo ao pedido e não cobrança antes de confirmação.

## Critérios de aceite
- Zero publicação automática de qf_chamados a partir de uma postagem externa.
- Zero notificação ou débito de créditos por lead em staging.
- Dados demonstrativos identificados como simulação.
- Captura automática somente após configurar pelo menos uma fonte real com permissão comprovada.
- Primeiro executar em ambiente de teste; validar métricas e segurança antes de merge/deploy.
