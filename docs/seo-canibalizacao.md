# Separação de intenções de busca

As alterações são propostas na branch `seo/canibalizacao`. Não incluem alterações
em pedido, pagamento, carteira, notificações ou painel, nem publicação na main.

## Hierarquia editorial

“Principal” é a referência de navegação do grupo, não o canonical das páginas
especializadas. Cada especialidade mantém o seu escopo e a sua URL.

| Principal | Intenção principal | Secundárias e intenções |
| --- | --- | --- |
| Pedreiro | Alvenaria, muros, reboco e paredes | Azulejista/Pisos: piso, azulejo, porcelanato e rejunte; Gesseiro: forros, sancas e drywall |
| Eletricista | Instalação elétrica, fiação, tomadas e disjuntores | Automação residencial: casa inteligente; CFTV e alarmes: videomonitoramento e sensores |
| Jardineiro | Conservação de jardim, gramado e canteiros | Poda/Paisagista: manejo arbóreo e projeto paisagístico |
| Diarista | Limpeza doméstica de rotina | Faxina pós-obra: resíduos de reforma; Passadeira: roupas |
| Frete/Carreto | Poucos objetos e pequenas cargas | Mudanças: transferência de residência ou escritório com inventário |
| Técnico em informática | Computadores, notebooks e sistema operacional | Internet e redes: Wi-Fi, roteadores e cabeamento |
| Mecânico | Motor, freios e suspensão | Autoelétrico: circuitos, alternador e partida; Bateria: teste e troca compatível |
| Limpeza de sofá | Sofá, manchas e cuidados do tecido | Limpeza de estofados e tapetes: cadeiras, poltronas, colchões e tapetes |

As secundárias apontam para a principal do grupo, incluindo a página do mesmo
município quando existe. O texto de Pedreiro não usa as palavras de revestimentos.

## Conteúdo municipal e URLs

- `scripts/seo-intent-content.cjs`: escopos dos serviços e variantes de busca.
- `scripts/seo-city-content.cjs`: 11 textos municipais, referências de bairro,
  instruções de localização e perguntas locais distintas.
- `scripts/seo-intentions.cjs`: última etapa editorial do build, antes da validação
  do sitemap. Revisa 27 páginas gerais e 853 páginas de serviço + cidade.
- Páginas municipais, inclusive as antigas, têm canonical para sua própria URL,
  schema coerente com o conteúdo visível e entrada no sitemap.
- As variantes municipais legadas de informática, pintura, diarista e sofá têm
  ângulos próprios (triagem, preparação, planejamento e avaliação do tecido).
- Variantes gerais legadas apontam para a URL principal da respectiva intenção.
  Por exemplo, `/higienizacao-de-sofa/` aponta para `/limpeza-de-sofa/`. Elas não
  entram no sitemap como canônicas independentes.
- Os guias `/abc/` permanecem regionais e não recebem o canonical das cidades.
- O build regenera os arquivos em `dist/`; não editar os HTMLs antigos na raiz ou
  em `servicos/` esperando que prevaleçam sobre os geradores.

Links e scripts existentes dos CTAs são preservados, incluindo parâmetros de
atribuição. A mudança é editorial; não altera a lógica do formulário.

## Referências geográficas

Os nomes municipais vêm de `data/localidades.json` (IBGE). Bairros de Santo André,
São Bernardo, Diadema, Guarulhos e Ribeirão Pires são conferidos nessa base.
Quando a base só contém regiões administrativas ou não contém bairros, os
exemplos foram conferidos nas fontes municipais abaixo em 17/10/2026:

- Mauá: [anexo da Lei 5.250/2017](https://sistemas.maua.sp.gov.br/legislaconsulta/atosofic/Leis/5250%20-%20anexo.pdf).
- Rio Grande da Serra: [unidades de saúde](https://www.riograndedaserra.sp.gov.br/contato-3/caps/).
- São Paulo: [Lei 11.220/1992, distritos](https://legislacao.prefeitura.sp.gov.br/lei-11220-de-20-de-maio-de-1992/consolidado).
- Suzano: [referências das regiões municipais](https://suzano.sp.gov.br/segunda-etapa-do-programa-cidade-viva-comeca-no-imperador-monte-cristo-e-parque-maria-helena/).
- Bauru: [Vila Falcão e Jardim Bela Vista](https://www2.bauru.sp.gov.br/materia.aspx?n=45159).
- Ribeirão Preto: [Campos Elíseos e Ipiranga](https://www.ribeiraopreto.sp.gov.br/portal/noticia/saerp-executa-intervencoes-no-sistema-de-abastecimento-da-regiao-norte).

Os exemplos não afirmam cobertura, estoque de profissionais, preço, tempo de
deslocamento ou disponibilidade. São referências para localizar o pedido.

## Validação

Executar `npm run build` e `npm test`. A suíte verifica a separação dos grupos,
os links para a principal, canonical próprio e sitemap das 853 páginas locais,
FAQs visíveis iguais ao schema, conteúdo municipal diferente depois de remover
nomes de cidade/bairro, nomes de limpeza e destinos dos links editoriais.

A ausência de canibalização nos resultados de pesquisa não é garantida pelo
build: após eventual merge e publicação, acompanhar consultas e URLs no Search
Console. Canonical é um sinal, e o Google pode selecionar outra URL:
[documentação oficial](https://developers.google.com/search/docs/crawling-indexing/canonicalization).
