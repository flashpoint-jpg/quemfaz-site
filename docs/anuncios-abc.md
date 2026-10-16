# QuemFaz — preparação para Google Ads e Microsoft Ads (Grande ABC)

Versão 11.96 · 16/10/2026 · arquivo interno (não é publicado no site: `.vercelignore` exclui `*.md`).

Nada foi alterado nos painéis de anúncio. Este documento traz a auditoria (somente leitura) e o que configurar.

## 1. Auditoria do Google Ads (conta 734-351-8086), lida em 16/10/2026

| Campanha | Tipo | Status | Orçamento/dia | Últimos 30 dias |
|---|---|---|---|---|
| quemfaz_clientes_abc_instalacao_pintura | Pesquisa | Ativa | R$ 16,00 | 104 cliques · 11 conv. · R$ 247,26 |
| quemfaz_clientes_abc_reparos_limpeza | Pesquisa | Ativa | R$ 14,00 | 117 cliques · 9 conv. · R$ 202,82 |
| QuemFaz \| Profissionais \| Cadastro \| Pesquisa \| SP \| OUT26 | Pesquisa | Pausada | R$ 11,00 | — |
| Performance Max-1 | PMax | Pausada | R$ 20,70 | — |
| Móveis Populares \| Flashpoint … | Pesquisa | Pausada | R$ 44,30 | — |

Ações de conversão: **"Pedido publicado"** (ID 7662297511) é a única primária — categoria lead, uma por clique, janela de 30 dias. Ela é disparada pelo site em `qfGoogleLead()` (rótulo `AW-18273159663/RIX-CKfD1cUcEO-TqYlE`) só depois que o Supabase confirma o pedido gravado, com o id do pedido como `transaction_id`.

Pontos de atenção encontrados:

1. **Valor da conversão em USD** ("1 USD always") numa conta em reais. Trocar para BRL evita relatórios de valor confusos.
2. **Buscas de fora do ABC** gastando verba: Mogi das Cruzes, Guarulhos, Bauru, Limeira, Piracicaba, Araras, Carapicuíba, Osasco, Sorocaba, Santos, São José do Rio Preto, Itaquaquecetuba, Suzano, Várzea Paulista, Tatuapé, Pinheiros, Pirituba, "zona leste", "zona sul". Em Configurações da campanha → Locais → Opções, usar **"Presença: pessoas que estão ou costumam estar nos locais segmentados"** (em vez de "Presença ou interesse").
3. **Buscas de "faça você mesmo"** (como limpar sofá, receita/mistura para limpar sofá, como instalar drywall, como montar cômoda) e de **quem quer trabalhar** ("eu sou marido de aluguel", "pedreiro na diária e na empreitada"). Lista de negativas no item 4.
4. A campanha de profissionais (pausada) recebia "freelancer", "aplicativo de freelancer", "anthor app". Se for reativada, revisar negativas antes.

Microsoft Advertising (conta G1456T9G): **não está conectado** às ferramentas desta sessão, então não foi possível auditar campanhas, orçamento nem tags UET. Nada foi criado lá.

Google Analytics 4: não há propriedade GA4 instalada no site e a consulta de propriedades não pôde ser feita (cota da ferramenta esgotada até 14/11/2026). O site está pronto para receber o ID (item 3).

## 2. Correspondência anúncio → página → formulário

Cada guia abaixo tem botão "Publicar pedido grátis" que abre o formulário já com o serviço escolhido e repassa `utm_*`, `gclid`, `gbraid`, `wbraid`, `msclkid` e `fbclid` para o pedido (fica gravado em `qf_chamados.marketing_origem`).

| Grupo de anúncio / busca | URL final sugerida |
|---|---|
| Eletricista (ABC) | `https://quemfazservico.com.br/servicos/eletricista/abc/` |
| Eletricista em Santo André | `https://quemfazservico.com.br/servicos/eletricista/santo-andre/` |
| Eletricista em Diadema | `https://quemfazservico.com.br/servicos/eletricista/diadema/` |
| Encanador (ABC) | `https://quemfazservico.com.br/servicos/encanador/abc/` |
| Encanador em São Bernardo | `https://quemfazservico.com.br/servicos/encanador/sao-bernardo-do-campo/` |
| Pintor (ABC) | `https://quemfazservico.com.br/servicos/pintor/abc/` |
| Pintor em Mauá / Diadema | `…/servicos/pintor/maua/` · `…/servicos/pintor/diadema/` |
| Diarista / limpeza residencial | `https://quemfazservico.com.br/servicos/diarista/abc/` |
| Diarista em Santo André | `https://quemfazservico.com.br/servicos/diarista/santo-andre/` |
| Limpeza / higienização de sofá | `https://quemfazservico.com.br/servicos/limpeza-de-sofa/abc/` |
| Limpeza de sofá em São Bernardo | `https://quemfazservico.com.br/servicos/limpeza-de-sofa/sao-bernardo-do-campo/` |
| Limpeza de estofados / colchão / tapete | `https://quemfazservico.com.br/servicos/limpeza-de-estofados-e-tapetes/abc/` |
| Marido de aluguel / instalação e manutenção | `https://quemfazservico.com.br/servicos/marido-de-aluguel/abc/` |
| Pedreiro, montador, telhadista, desentupidor (sem guia ABC) | Manter a home ou a calculadora, como hoje |

Sufixo do URL final recomendado (nível de conta): `utm_source=google&utm_medium=cpc&utm_campaign={_campanha}&utm_content={_grupo}` — os nomes atuais `quemfaz_clientes_*` continuam funcionando e já aparecem no painel do QuemFaz. Na Microsoft, deixar **marcação automática (msclkid) ligada** e o sufixo `utm_source=bing&utm_medium=cpc&utm_campaign={Campaign}&utm_content={AdGroup}`.

Texto dos anúncios: as páginas prometem só o que existe — publicar grátis, sem cadastro, contato pelo WhatsApp, cliente escolhe de 1 a 4 orçamentos. Evitar "profissionais verificados" (só parte deles tem o selo) e números de clientes.

## 3. Rastreamento — o que falta configurar (depende de você)

| Plataforma | Situação no código | O que fazer |
|---|---|---|
| Google Ads | Ativo (conversão "Pedido publicado") | Nada obrigatório. Opcional: corrigir moeda para BRL. |
| Google Analytics 4 | Pronto, desligado (`ga4: ''`) | Criar a propriedade/fluxo da web e colar o ID `G-…` em `qf-conversao.js` → `QF_TRACKING_CONFIG.ga4`. Marcar `pedido_publicado` como evento principal (key event). |
| Microsoft UET | Pronto, desligado (`uet: ''`) | Microsoft Ads → Ferramentas → Tags UET → criar tag (sem auto-instalação). Colar o número da tag em `QF_TRACKING_CONFIG.uet`. Criar meta de conversão "Evento personalizado" com **Ação = pedido_publicado**, contagem "Única", janela 30 dias. |
| Meta Pixel | Ativo (Lead com eventID por pedido) | Nada. |

Eventos enviados (todos sem nome, telefone, endereço, bairro ou texto do pedido):

- `pedido_iniciado` — busca da home enviada ou primeira interação com o formulário (1× por sessão).
- `pedido_formulario_avancado` — etapa 1 concluída (1× por sessão).
- `pedido_publicado` — somente após o Supabase devolver o pedido gravado; 1× por pedido, mesmo recarregando. Pedido urgente só conta quando o Pix é aprovado.

Consentimento: aviso de cookies com "Aceitar/Recusar". Por padrão (`QF_CONSENT_PADRAO = 'granted'` no `index.html`) a medição segue como antes até a pessoa recusar. Para exigir aceite antes de medir, troque para `'denied'` — o aviso passa a aparecer na hora e as conversões caem até as pessoas aceitarem.

Para contar pedidos reais por campanha (fonte da verdade, não depende de cookie):

```sql
select coalesce(marketing_origem->>'source','(sem origem)') as origem,
       coalesce(marketing_origem->>'campaign','') as campanha,
       marketing_origem->>'click_type' as clique,
       count(*) as pedidos
from qf_chamados
where criado_em >= now() - interval '30 days' and status <> 'aguardando_pagamento'
group by 1,2,3 order by 4 desc;
```

## 4. Palavras-chave negativas propostas

Arquivo pronto para o Google Ads Editor / Microsoft Ads Editor: `docs/negativas-clientes-abc.csv` (lista compartilhada, aplicar às duas campanhas de clientes). Não aplicar na campanha de profissionais.

- **Emprego e vagas:** vaga, vagas, emprego, empregos, trabalhe conosco, contrata-se, contratando, currículo, curriculo, salário, salario, carteira assinada, "eu sou", "sou diarista", "sou eletricista", "sou pintor", "sou encanador", "sou marido de aluguel", trabalhar como, quero trabalhar, freelancer, freela.
- **Cursos e aprendizado:** curso, cursos, senai, apostila, certificado, certificação, aula, aprender, treinamento, nr10, nr 10.
- **Faça você mesmo:** como fazer, como limpar, como instalar, como montar, como trocar, passo a passo, receita, mistura, caseiro, caseira, tutorial, vídeo, video, youtube, pdf, desenho, esquema elétrico.
- **Fora do ABC (complementa o ajuste de "Presença"):** guarulhos, mogi das cruzes, bauru, limeira, piracicaba, araras, carapicuiba, osasco, sorocaba, santos, sao jose do rio preto, itaquaquecetuba, suzano, varzea paulista, campinas, tatuape, pinheiros, pirituba, zona leste, zona sul, zona norte, zona oeste.
- **Outros sem intenção de contratar:** grátis download, app download, significado, o que é, salário de, quanto ganha.

Não negativar: "perto de mim", "preço", "valor", "orçamento", "tabela de preço", "maria brasileira" (houve conversão), "em casa" (aparece em buscas de serviço, como "limpeza de sofá em casa").

## 5. Microsoft Advertising — plano para R$ 10/dia (não executado)

1. Auditar primeiro: listar campanhas existentes; **não duplicar** nem ativar as pausadas.
2. Usar **orçamento compartilhado** de R$ 10/dia para todas as campanhas de clientes (garante o teto total).
3. Importação do Google Ads: **não** configurar importação automática; recarga automática **desligada**; não adicionar saldo pelo assistente.
4. Começar com 2 grupos de alta intenção: (a) eletricista/encanador no ABC, (b) limpeza de sofá/estofados no ABC, com as URLs do item 2 e a lista de negativas.
5. Lances: CPC manual ou "Maximizar cliques" com limite de CPC até haver 15+ conversões; depois avaliar "Maximizar conversões".
