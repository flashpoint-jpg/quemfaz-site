# Pedidos com valor definido, baixa por QR e cancelamento — guia de revisão

Branch `feature/quemfaz-pedidos-valor-qr` · especificação: issue #87 · **tudo nasce DESLIGADO** (`qf_config.pedidos_valor_definido.ativo = false`).

## O que existe
| Área | Onde | Como funciona |
|---|---|---|
| Duas modalidades | formulário do cliente (`index.html`, etapa 3) | Com a chave ligada aparece "Receber até 4 contatos" (atual) e "Já tenho um valor para pagar". Valor, material e confirmação são obrigatórios; o banco valida de novo (faixa de valor, `max_orcamentos = 1`, valor imutável após publicar). |
| Taxa de indicação | `qf_taxas_indicacao`, `qf_taxa_indicacao_centavos` | 6% (600 bps) arredondando meio para cima, teto opcional por profissão (`padrao` vale para todas, inclusive profissões futuras). Preços tradicionais não são tocados. |
| Desbloqueio | `qf_desbloquear_chamado_valor` | Mostra a taxa exata antes; cobra do saldo (Pix = recarga já existente); contato só abre após o débito; `unique(chamado_id, profissional_id)` + trava no banco impedem cobrança dupla; só 1 profissional. Se a taxa mudou entre a tela e o clique, devolve `taxa_mudou` sem cobrar. |
| Barreira | trigger em `qf_desbloqueios` | Qualquer desbloqueio de pedido com valor fora da função nova (inclusive a antiga `qf_desbloquear_chamado` e o "exclusivo") é recusado. |
| Baixa por QR | `qf_solicitar_baixa`, `qf_conclusoes`, `confirmar-servico.html` | Profissional gera link/QR de uso único (hash SHA-256 no banco, token só no `#` da URL). **Só a conta do cliente dono do pedido** responde: concluído (nota 1–5 → avaliação real), com problema, não realizado. Profissional não confirma por ele. Admin pode encerrar com evidências (sem nota). |
| Cancelamento | `qf_cliente_cancelar_pedido` | 5 motivos, data/hora, registra desbloqueios, avisa profissionais, **sem estorno automático**. |
| Contestação | `qf_contestar_desbloqueio`, `qf_admin_resolver_contestacao` | Profissional contesta com evidências (prazo configurável, 15 dias); admin estorna (um único lançamento `estorno`) ou nega. |
| Suspeitos | `qf_admin_cancelamentos_suspeitos` | Apenas lista para revisão humana. Não bloqueia ninguém. |
| Carteirinha | `carteirinha.html`, `qf-carteirinha-extras.js`, `qf_carteirinha_publica_v2` | Com a chave ligada: profissão, Compartilhar (share nativo/WhatsApp), Copiar link, Baixar PDF (gerado no aparelho), Imprimir (já existia). O QR continua identificando só o profissional. |
| Painel admin | `qf-admin-valor.js` (dashboard) | Liga/desliga, taxa e teto por profissão, lista de pedidos (valor, taxa, quem desbloqueou, pagamento, baixa, nota, cancelamento, contestação), histórico completo, suspeitos. |

## Pós-avaliação: instalar o app e pedir outro serviço
`qf-pos-avaliacao.js`, usado por `confirmar-servico.html` (link/QR do pedido) e `avaliar.html` (QR da carteirinha). Depois de avaliar mostra "Serviço finalizado com sucesso!" com:
* **Instalar aplicativo grátis**: Android → link oficial já configurado (`play-links.js` → `LINK_DA_LOJA`, só aceita https da Play Store); navegador com `beforeinstallprompt` → instalação PWA; iPhone → instrução. Escondido se o app já está instalado (modo standalone, APK/Capacitor, marca `qf_pwa_installed`, `getInstalledRelatedApps`) e, se o cliente tocar "Agora não", não volta por 30 dias.
* **Solicitar outro serviço**: abre o formulário normal na raiz do site, sem exigir instalação ou cadastro; modalidades e profissões vêm do próprio formulário (nada específico por categoria).
* O botão do profissional chama-se "Solicitar finalização do serviço".
* QR da carteirinha: com a chave ligada e o cliente logado com finalização pendente daquele profissional, `avaliar.html` segue para a confirmação do pedido; sem conta, mantém a avaliação rápida atual e mostra o link "finalizar o serviço".

## Migração (NÃO aplicada em produção)
`supabase/2026-10-18-pedidos-valor-definido-qr.sql` — aditiva (tabelas/colunas novas, funções novas, 2 triggers, 1 constraint). Única função existente reescrita: `qf_private.devolver_lead` (mesmo corpo de produção + retorno 0 para pedidos com valor definido).
Reversão: `...-rollback.sql` (preserva tabelas e dados). Para só desligar: `update public.qf_config set valor = valor || '{"ativo": false}' where chave='pedidos_valor_definido'`.
Backups dos arquivos alterados: `docs/backup-pre-valor-qr/`.

## Ordem sugerida de publicação (depois da aprovação)
1. Aplicar a migração em um branch Supabase / staging e rodar `tests/valor-definido-db.sql`.
2. Deploy do front (chave desligada — nada muda para ninguém).
3. Ligar a chave pelo painel admin para teste interno; revisar; só então liberar.

## Testes
* `tests/valor-definido-db.sql` (+ fixture `tests/fixtures/valor-definido-schema.sql`): 19 grupos de asserções em PostgreSQL 16 (flag, validação, taxa/teto, débito, duplicidade, limite 1, bloqueio da função antiga, privacidade, imutabilidade, baixa/QR, replay/expiração, nota, encerramento admin, cancelamento sem estorno, contestação/estorno único, reabertura, suspeitos, grants, carteirinha v2). Rodado também com 8 mutações no código (todas detectadas).
* `tests/valor-definido-db.test.cjs`: mesmo SQL via PGlite (`npm test`); inclui teste do rollback.
* `tests/valor-definido-front.test.cjs`, `-carteirinha.test.cjs`, `-integracao.test.cjs`: valor/taxa/validação, textos, links, PDF (validado com `qpdf`), admin, travas da chave.

## Limitações conhecidas
* **Pix direto por desbloqueio não existe**: o Pix é a recarga de carteira já existente (o diálogo leva o profissional para recarregar e voltar). Um checkout Pix por taxa exigiria mexer no webhook da Efí — fora do escopo desta PR.
* **Fotos** do pedido B seguem o fluxo atual (adicionadas após publicar); o formulário rápido não tem upload.
* **Notificações**: a distribuição (profissão, raio, horário) reutiliza as regras atuais sem alteração; não foi testada ponta a ponta com push real.
* O ambiente de desenvolvimento não alcançava o registro npm: `npm test`/build (esbuild) e o wrapper PGlite não puderam ser executados aqui. Seis testes já falhavam na `main` por depender do build.
* A migração foi validada contra um schema reduzido espelhando as constraints de produção, não contra o banco real.
