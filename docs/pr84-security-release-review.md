# PR #84 — Revisão final de segurança (não é aprovação de produção)

## Evidência confirmada
- GitHub Actions Testar Funil Quem Faz #62: 175/175 aprovados no commit anterior à correção de noindex.
- SEO consent checks #14: success no commit anterior.
- Revisão estática do SQL proposto: tabela qf_seo_consentimentos com RLS habilitado; políticas próprias para SELECT/INSERT/UPDATE; SELECT anon revogado; default false; revogação com autorizado=false e autorizado_em=NULL.
- Nenhuma migração foi aplicada, nenhum dado de produção foi consultado ou alterado.
- Workflow .github/workflows/seo-consent-db-manual.yml permanece desabilitado por if:false, aguardando confirmação de billing.

## Problema encontrado e corrigido
- scripts/generate-seo-pages.cjs gerava páginas locais genéricas com meta robots index,follow apesar de excluí-las do sitemap.
- Corrigido para noindex,follow; páginas de serviço gerais permanecem index,follow.
- Teste de regressão criado em tests/seo-local-index-safety.test.cjs.
- Mudança NÃO revalidada por npm test até confirmação de execução; não considerar aprovada.

## Escopo de indexação previsto (depende de build)
- Indexáveis: home, páginas gerais de serviços, guias editoriais ABC e páginas locais com conteúdo editorial específico geradas por seo-abc.cjs, conforme seus canonicals e sitemap.
- Não indexáveis: páginas locais genéricas geradas por generate-seo-pages.cjs sem elegibilidade confirmada; páginas finas consolidadas para guia ABC não devem aparecer no sitemap.
- Páginas editoriais são conteúdo estático, não devem conter CPF, email privado, telefone, endereço, coordenadas, pedidos ou saldos.
- API pública de profissionais permanece em api-inactive, sem rota de produção e sem view autorizada no banco.

## BLOQUEIOS antes de liberar produção
1. Rodar SQL em banco descartável compatível com Supabase, com RLS real e roles anon/authenticated; verificar acesso anon a tabelas privadas, leitura cruzada, opt-in e revogação.
2. Validar que a fixture SQL simula corretamente as políticas reais do Supabase; PostgreSQL genérico com auth.uid simulada não equivale a teste Supabase Auth completo.
3. Verificar consentimento na UI com tabela ausente/presente e comportamento de revogação.
4. Executar npm test no commit mais recente e revisar o sitemap final, meta robots e canonicals gerados.
5. Confirmar franquia e limites de cobrança GitHub Actions antes de iniciar jobs adicionais.
6. Revisão humana antes de merge/deploy.

Conclusão: PR NÃO está pronto para publicação.
