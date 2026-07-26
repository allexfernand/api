# Consolidação da Análise Sinistro sobre a Gold

Data: 2026-07-26
Sub-projetos: **B** e **C** de três (A entregue em `2026-07-25-lineage-inspector-sinistralidade-360-design.md`)

## Problema

A seção Sinistralidade tem três abas que respondem perguntas sobrepostas a partir de
fontes diferentes. A **Análise Sinistro** lê `utilizacao_silver_stage`; o **Preview Gold**
lê `gold_sinistro_evento_v2` e seus marts; a **Visão 360** lê os marts longitudinais.
Duas delas mostram evolução mensal de sinistro, com números que divergem sem que a
interface explique por quê.

A divergência não é estética. Medida ao vivo em 2026-07-26:

| Fonte | Linhas | Sinistro | Usuários únicos |
|---|---|---|---|
| `utilizacao_silver_stage` (Análise Sinistro) | 1.571.862 | R$ 165.743.202,33 | **33.488** |
| `gold_sinistro_evento_v2` (Preview Gold) | 1.571.861 | R$ 165.740.442,33 | **27.850** |

Volume e valor são praticamente idênticos — uma linha e R$ 2.760 de diferença, que é a
linha com data no ano 0205 filtrada por `flag_data_suspeita`. Mas a contagem de usuários
diverge em 16,8%, e a causa é um defeito de dados na origem.

### A causa raiz da divergência de usuários

A Análise Sinistro conta usuários pela chave composta `Codigo_Usuario + cpf_titular`.
Decompondo essa chave na Silver:

| Chave | Distintos |
|---|---|
| `Codigo_Usuario` sozinho | 27.478 |
| `Codigo_Usuario + cpf_titular` | 33.488 |
| `person_key` da Gold | 27.850 |

Oito valores de `Codigo_Usuario` respondem por 6.018 das combinações. Dois deles são
`8,65E+15` e `8,6501E+15` — **notação científica**. Códigos numéricos de 16 dígitos foram
exportados em notação científica em algum ponto da ingestão da CNU, colapsando milhares de
códigos distintos em duas strings. São 76.934 linhas e R$ 9,03 milhões, 5,4% do sinistro.

A Gold repara isso. Das 76.934 linhas corrompidas, 76.011 são remapeadas por
`unique_identity_map` para 7.802 pessoas reais, e 923 caem em `fallback_identity`
(171 pessoas). A soma fecha exatamente.

**Conclusão que orienta este projeto:** a contagem de 33.488 da aba atual não é uma
medida alternativa — é errada, e infla em 5.886 identidades fantasma geradas por um
artefato de exportação. Consolidar sobre a Gold não perde usuários; para de inventá-los.

## Resultado esperado

A seção Sinistralidade fica com duas abas. **Análise Sinistro** passa a ser o conteúdo
hoje chamado Preview Gold, reescrito em React, acrescido da série por competência de
cobrança e do modo de linhagem Databricks. **Visão 360** segue como está.

## Escopo

**Dentro:**
- Reescrita dos 15 blocos do Preview Gold em React, no padrão da Visão 360.
- Série por competência de cobrança no `/api/gold-preview` (a única lacuna de dados real).
- Série trimestral derivada no cliente a partir da série mensal existente.
- Entradas de linhagem para os blocos desta aba — o pedido original cobria as duas abas
  e o sub-projeto A entregou só a Visão 360.
- Consolidação da navegação: 12 abas passam a 11.
- Remoção de `gold-preview.js`, `claims.js`, os dois fragmentos HTML e os re-exports.

**Fora:**
- Qualquer mudança nas 17 consultas existentes do `gold-preview.ts`. Os números que a
  aba mostra hoje são os que vai mostrar depois.
- Reescrita da Visão 360.
- Correção do defeito de notação científica na origem — é ingestão da CNU, não dashboard.
  Fica registrado aqui como achado a levar à operadora.
- Regressão visual automatizada: o projeto não tem essa infraestrutura.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| O que migrar dos 4 gráficos | Só competência e trimestral | #AS01 já é o bloco B1; #AS03 é agregação da série mensal; #AS04 tem equivalente em B6/B7 por família |
| Coorte antes/depois | Fica só a de família (B6/B7) | Duas leituras divergentes da mesma pergunta obrigam o leitor a saber qual usar |
| Números de fallback | Removidos | 26 valores de 10/jul cravados no HTML; numa aba oficial, falha tem que parecer falha |
| Rollout | Troca direta, sem nota na tela | Decisão do dono do produto; o modo de linhagem cobre quem quiser auditar |
| Blocos que sobrevivem | Todos os 15 | Construídos sobre a Gold e já validados |
| Forma da API | Payload único preservado | É o que faz o filtro facetado recalcular tudo de uma vez; 15 escopos seriam 15 viagens reaplicando o mesmo SQL |

Rejeitado: quebrar a API em escopos como a v2 (resolveria um problema que esta aba não
tem e criaria um que ela não tem); payload em duas ondas (duas fontes de verdade sobre
"a aba carregou").

## Arquitetura

```
src/features/claims/
  ClaimsTab.tsx                    ← substitui os dois re-exports de FeatureTab
  ClaimsTab.module.css
  hooks/useGoldPreview.ts          ← payload único, estados explícitos
  hooks/useGoldPreviewFilters.ts   ← 6 facetas, sincronizadas com a URL
  components/
    ClaimsHeader.tsx     FacetPanel.tsx      ExecutiveKpis.tsx
    MonthlySeries.tsx    EventMix.tsx        Locations.tsx
    Concentration.tsx    Hospitalization.tsx SanusImpact.tsx
    SanusJourney.tsx     TopUsers.tsx        Methodology.tsx
```

Fluxo:

```
ClaimsTab
  └─ LineageProvider available={role === "full"}
      ├─ useGoldPreviewFilters()   ← pg_faixa, pg_sexo, pg_plano, pg_cidade,
      │                              pg_estado, pg_servico
      ├─ useGoldPreview(filtros)   ← GET /api/gold-preview?<facetas>
      │     loading | ready | forbidden | error
      ├─ ClaimsHeader → FacetPanel → 10 componentes de conteúdo
      └─ LineageDrawer
```

**Sobre a contagem, para não confundir o plano:** o payload tem 15 seções, e elas viram
10 componentes de conteúdo, porque alguns agrupam seções irmãs que sempre aparecem
juntas — `concentracao` + `prestadores` em `Concentration`, `internacao` + `saude_mental`
em `Hospitalization`, `impacto_sanus` + `comparacao_madura` em `SanusImpact`. Somando o
cabeçalho (que consome `fonte` e `carteira`), o painel de facetas (`filtros`) e o card de
metodologia (texto estático), são 13 componentes. "Os 15 blocos" ao longo deste documento
se refere às seções do payload, que é o que o usuário enxerga como blocos na tela.

Os gráficos usam os primitivos já revisados de `src/features/sinistralidade/components/charts.tsx`
(`ChartCard`, `LineChart`, `StackedBarChart`, `ParetoChart`, `ScatterChart`). Chart.js
deixa de ser usado nesta aba.

**Estado é da aba, não do bloco.** Na Visão 360 cada bloco tem estado próprio porque cada
um tem endpoint próprio. Aqui o payload é único: enquanto carrega, a aba carrega; se
falha, a aba mostra erro com repetir. Sem números de fallback.

O painel de facetas mantém o comportamento atual — o usuário monta o recorte e clica em
"Aplicar recorte". Não há busca a cada tecla.

## Servidor

Duas adições ao `src/server/routes/gold-preview.ts`, nenhuma remoção.

**Série por competência** — uma consulta a mais no `Promise.all` existente, espelhando a
que o escopo `timeline` da v2 já usa:

```sql
SELECT date_format(to_date(competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') AS competencia,
       round(sum(custo_assistencial_bruto), 2), sum(quantidade_servicos), count(*)
FROM gold_sinistro_evento_v2
WHERE NOT flag_data_suspeita ...
GROUP BY 1
```

Entra no payload como `competencia`, irmã de `mensal`. Responde "quanto foi faturado no
mês", contra o "quanto foi atendido no mês" da série existente.

**Papel do usuário** — o bloco `fonte` ganha `role`, como o `scope=metadata` fez para a
Visão 360. É o que alimenta `LineageProvider available={role === "full"}`.

**Série trimestral** não vira consulta: `mensal` já traz eventos, usuários e valor por
mês, e o trimestre é agregação no cliente.

### Linhagem

As entradas ficam em `src/server/sinistralidade/queries/gold-preview-lineage.ts` e entram
no agregador `lineage.ts` como as demais. Uma entrada por bloco clicável — o plano
enumera a lista final junto com os `lineageId`, como o sub-projeto A fez para os quinze
blocos da Visão 360. O registro sai das 25 entradas atuais para cerca de 38.

**Ressalva registrada:** aqui a co-locação é mais fraca que nas 25 entradas atuais. O SQL
mora em `src/server/routes/gold-preview.ts`, não ao lado da constante. A alternativa era
inflar um arquivo de 600 linhas para cerca de 900. O cabeçalho do arquivo declara a
separação, e o mapa `ENTRY_SOURCE_FILES` do teste de coluna aponta essas entradas para o
arquivo da rota, de modo que a rede contra nome de coluna fabricado continua valendo.

## Consolidação da navegação

| Onde | Mudança |
|---|---|
| `DashboardShell.tsx`, `navSections` | A seção Sinistralidade perde `preview-gold`; ficam `analise-sinistro` e `sinistralidade-v2` |
| `DashboardTabs.tsx:23-24` | Os dois re-exports viram um `<ClaimsTab />` sob o id `analise-sinistro` |
| `core.js:1364` | Sai o despacho `activeTab === 'analise-sinistro' → renderAnaliseSinistro()` |
| `core.js:277` | `isSinistroTab` deixa de listar `preview-gold` |
| `app/page.tsx:11` | Sai a tag `<Script src="/scripts/gold-preview.js">` |
| `public/scripts/dashboard.js:2` | Sai `claims.js` da lista de chunks |

O id que sobrevive é `analise-sinistro`. `preview-gold` deixa de existir.

**Dependências cruzadas verificadas:** `claims.js` expõe `renderAnaliseSinistro`, chamada
pelo `core.js` nos dois pontos acima, e `median`, usada pelo `gold-preview.js` — que
também é removido, então essa se resolve sozinha. `median` vira função TypeScript local
no componente que precisar dela.

Total de abas: **12 hoje, 11 depois**. Note que `docs/architecture.md` diz "dez abas" e já
está desatualizado; atualizar junto.

## Estados e erros

Reusa `BlockState`: carregando, erro com repetir, vazio, e sem-permissão. O perfil MDS já
recebe 403 do `/api/gold-preview` e não alcança a seção na navegação.

## Testes

**Unitários** (`tests/unit/`, ambiente node):
- A série por competência agrupa `dd/MM/yyyy` em `yyyy-MM` e descarta data inválida.
- A agregação trimestral soma os meses corretos e não cria trimestre sem dado.
- As entradas novas de linhagem passam no teste de coluna fabricada existente.

**E2E** (`tests/e2e/dashboard.spec.ts`):
- A aba Análise Sinistro carrega e mostra os KPIs.
- Aplicar uma faceta recalcula os blocos.
- O modo de linhagem abre a gaveta num bloco desta aba.
- A navegação tem 11 entradas. **O teste atual percorre as abas e vai quebrar por motivo
  correto quando uma sumir** — ajustar junto, não depois.

**Conferência visual manual** dos 15 blocos, como passo explícito do plano. Foi assim que
a colisão do selo de linhagem apareceu na Task 9 do sub-projeto A; nenhum teste
automatizado deste projeto teria pego.

## Critérios de aceite

1. A seção Sinistralidade mostra duas abas; `preview-gold` não existe mais.
2. A Análise Sinistro renderiza os 15 blocos com os dados atuais do `/api/gold-preview`.
3. A série por competência aparece ao lado da série por data de atendimento, cada uma
   rotulada com o eixo que usa. Isto é rotulagem de gráfico, não a "nota de mudança" que
   foi descartada na decisão de rollout — sem dizer qual eixo é qual, as duas séries
   viram dois números diferentes para a mesma pergunta.
4. O modo Análise Databricks funciona nesta aba, e cada bloco abre sua linhagem.
5. Nenhum número aparece na tela sem vir da API: `grep` por valores monetários cravados
   nos componentes novos não retorna nada.
6. `npm run lint`, `typecheck`, `test`, `build` e `test:e2e` passam.
7. `gold-preview.js`, `claims.js` e os dois fragmentos não existem mais, e nada os
   referencia.

## Riscos

| Risco | Mitigação |
|---|---|
| Reescrever 15 blocos introduz regressão visual silenciosa | Conferência manual bloco a bloco no plano; os números vêm do mesmo payload, então divergência é de apresentação e é visível |
| Mexer no `core.js` legado quebra outra aba | Os dois pontos de acoplamento estão identificados por linha; E2E percorre todas as abas |
| A queda de 17% na contagem de usuários gera chamado | Decisão consciente de não pôr nota na tela; o modo de linhagem mostra a fonte, e este documento registra a causa raiz |
| O arquivo de linhagem separado do SQL apodrece | O teste de coluna cobre nome fabricado; a ressalva está no cabeçalho do arquivo |

## Achado para levar à operadora

Independente deste projeto: 76.934 linhas da base de utilização têm `Codigo_Usuario` em
notação científica (`8,65E+15`, `8,6501E+15`), carregando R$ 9,03 milhões. É corrupção na
exportação da CNU, anterior à ingestão. A Gold contorna com mapa de identidade, mas o
certo é corrigir na origem — enquanto não for, 923 linhas seguem sem identidade
recuperável, no `fallback_identity`.
