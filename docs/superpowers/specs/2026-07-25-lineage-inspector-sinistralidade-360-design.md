# Inspetor de linhagem Databricks — Sinistralidade 360

Data: 2026-07-25
Sub-projeto: **A** de três (ver "Contexto maior" no fim)
Contrato afetado: `1.1.0` → `1.2.0` (aditivo)

## Problema

O dashboard apresenta números vindos do Databricks sem dizer de onde eles saem. Um mesmo
conceito — "custo de sinistro" — é calculado sobre a Silver numa aba e sobre a Gold em
outra, com regras de identidade diferentes, e nada na interface revela isso. Quem apresenta
o número não consegue defender a metodologia, e quem audita precisa abrir o código.

## Resultado esperado

Na aba Sinistralidade 360, um usuário do papel `full` liga o modo **Análise Databricks** e
passa a poder clicar em qualquer gráfico ou KPI para ver, numa gaveta lateral, quais
tabelas e colunas do Databricks alimentam aquele número, qual a fórmula em linguagem de
negócio, quais filtros foram aplicados e em que camada do medalhão o dado vive.

## Escopo

**Dentro:**
- Registro de linhagem para os 12 escopos longitudinais e os 9 KPIs executivos.
- Endpoint `scope=lineage` no handler existente `/api/sinistralidade/v2`.
- Toggle no cabeçalho, alvos clicáveis em `ChartCard` e `Kpi`, gaveta não-modal.
- Testes unitários (servidor + contrato) e E2E.

**Fora:**
- Aba Preview Gold e aba Análise Sinistro (sub-projetos B e C).
- Linhagem derivada automaticamente do Databricks.
- Exposição de SQL literal.
- Regressão visual automatizada — o projeto não tem essa infraestrutura e montá-la é
  escopo próprio.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Fonte da linhagem | Declarada no servidor, colada ao SQL | O drift é o risco real; no mesmo arquivo, quem edita o SQL vê a linhagem |
| Conteúdo | Fontes + colunas + regra de negócio | Responde "de onde vem" e "como foi calculado" sem virar ferramenta de DBA |
| Entrega | Endpoint dedicado `scope=lineage` | Metadado estático, cacheável, funciona com o bloco em `409 blocked` |
| Apresentação | Gaveta lateral direita, não-modal | Permite comparar linhagens clicando de um bloco a outro |
| Granularidade | Bloco inteiro + cada KPI | Cobre "o gráfico ou a métrica específica" sem o custo de alvos por série |
| Acesso | Papel `full`; `mds` recebe 403 | Nome de tabela é estrutura interna; consistente com `/api/gold-preview` |

Rejeitado: registro estático no frontend (apodrece silenciosamente); módulo TS compartilhado
com o cliente (mandaria a topologia do data lake para o bundle público); linhagem derivada de
`system.access.table_lineage` (o schema em uso é `hive_metastore`, com lineage limitada, e o
resultado não explicaria a regra de negócio).

## Arquitetura

```
AnalyticsHeader  ── toggle "Análise Databricks"
      │
      ▼
useLineageRegistry()  ──►  GET /api/sinistralidade/v2?scope=lineage
      │                          │
      │                          ▼
      │                    src/server/sinistralidade/lineage.ts
      │                          └─ agrega queries/*.ts + entradas de KPI
      ▼
LineageProvider  (contexto: { enabled, registry, activeId, open, close })
      │
      ├─► ChartCard      prop lineageId → alvo clicável quando enabled
      ├─► Kpi            prop lineageId → alvo clicável quando enabled
      └─► LineageDrawer  gaveta à direita, lê registry[activeId]
```

O escopo `lineage` responde de memória: **nenhuma consulta ao Databricks**. É tratado no
handler antes da resolução de período e do gate de fechamento, porque metadado não depende
de mês nem de empresa.

### Unidades e responsabilidades

| Unidade | Faz | Depende de |
|---|---|---|
| `queries/<dominio>.ts` | Declara `<DOMINIO>_LINEAGE` ao lado do SQL e de `<DOMINIO>_UNITS` | nada novo |
| `sinistralidade/lineage.ts` | Agrega as constantes dos 8 arquivos de query + 9 KPIs; expõe `lineageRegistry()` | `queries/*` |
| `sinistralidade/index.ts` | Roteia `scope=lineage`: `rejectMdsAuth` → `lineageRegistry()` → resposta | `lineage.ts` |
| `contracts/sinistralidade-v2.ts` | `lineageEntrySchema`, `lineageRegistrySchema`; `lineage` no enum de escopo | nada novo |

**Onde declarar o escopo `lineage`:** direto em `sinistralidadeScopeSchema`, **não** em
`longitudinalScopeSchema`. O handler usa `isLongitudinalScope()` para decidir o caminho de
execução; se `lineage` entrar no enum longitudinal, cai em `handleLongitudinal`, que exige
`end_month` e resolve gate de período — e o escopo passa a responder 400.
| `hooks/useLineageRegistry.ts` | Busca o registro uma vez e cacheia | contrato |
| `components/LineageProvider.tsx` | Estado do modo e do alvo ativo | hook |
| `components/LineageAnchor.tsx` | Torna qualquer bloco um alvo clicável quando o modo está ligado | provider |
| `components/LineageDrawer.tsx` | Renderiza uma entrada | provider |

O padrão de co-locação já existe no código: cada arquivo em `src/server/sinistralidade/queries/`
exporta suas unidades ao lado da query (`TIMELINE_UNITS`, `EVENT_MIX_UNITS`, `PROVIDER_UNITS`…).
A linhagem entra como constante irmã dessas.

## Contrato de dados

```ts
type LineageEntry = {
  id: string;              // "timeline" | "kpi.cost_per_utilizer"
  kind: "block" | "metric";
  label: string;           // "Evolução mensal de custo"
  layer: "silver" | "gold" | "mart" | "control";
  sources: {
    object: string;        // "hive_metastore.sanus_prod.mart_evento_empresa_mes_v2"
    role: string;          // "fato principal" | "denominador" | "gate de período"
    columns: string[];     // ["month_key", "custo_assistencial_bruto", "utilizantes"]
  }[];
  formula: string;         // "SUM(custo_assistencial_bruto) por month_key"
  filters: string[];       // ["company_key do escopo do usuário", "meses aprovados pelo gate"]
  notes?: string[];
  related?: string[];      // ids de entradas que dividem fonte ou denominador
};

type LineageRegistry = {
  contract_version: string;
  generated_at: string;
  entries: LineageEntry[];
};
```

Regras do conteúdo:

- `formula` descreve o cálculo, **nunca a instrução SQL executada**. Notação de função
  agregada (`SUM(custo_assistencial_bruto) ÷ COUNT(DISTINCT person_key)`) é permitida e
  preferida: é a convenção do próprio `docs/sinistralidade/metricas-v2.yaml`, e é mais
  precisa que prosa — "custo somado na janela" não diz qual coluna foi somada, que é
  exatamente a pergunta que esta ferramenta existe para responder. O que não pode aparecer
  é o SELECT completo, com seus filtros de `company_key`.
- `layer` é obrigatório — é o campo que responde "Silver ou Gold?".
- `filters` sempre declara o recorte por `company_key`, porque todo bloco aplica
  `companyScopeSql` e o usuário precisa saber que o número é da empresa dele.
- `related` liga entradas que dividem fonte ou dependem uma da outra. Caso concreto: o KPI
  "Custo por vida elegível" lê `vidas_elegiveis` de `mart_sinistro_empresa_mes_v2` — a mesma
  fonte do numerador — e só tem valor quando **todos** os meses incluídos têm snapshot
  contemporâneo; `related` aponta para `timeline.monthly`, onde o mesmo denominador aparece
  mês a mês.
- `notes` reaproveita texto já existente: os atributos `title` do Gold Preview seguem o
  formato *O QUE É / POR QUE EXISTE / SINAL / ARMADILHA*, e `docs/sinistralidade/IMPLEMENTACAO.md`
  tem a seção "Semântica de métricas (auditoria 2026-07-17)" com definições já fixadas.

### Entradas a escrever

A contagem não é uma por escopo: **um escopo pode renderizar vários blocos visíveis**, e o
usuário clica no bloco, não no escopo. `procedure-trends` desenha três cards (Pareto,
Dispersão, Custo mensal), `provider-trends` dois, `timeline` dois. Cada um tem colunas e
fórmula próprias, então cada um é uma entrada.

**15 blocos clicáveis:**

| id | Onde aparece |
|---|---|
| `timeline.competency` | `MonthlyEvolutionChart` — "Custo por competência" |
| `timeline.monthly` | `MonthlyEvolutionChart` — card com seletor de métrica |
| `event-mix.cost` | `EventMixChart` — "Custo por evento" |
| `top-users-window.table` | `TopUsersTable` |
| `procedure-trends.pareto` | `ProcedureAnalysis` — "Pareto" |
| `procedure-trends.scatter` | `ProcedureAnalysis` — "Dispersão" |
| `procedure-trends.monthly` | `ProcedureAnalysis` — "Custo mensal por procedimento" |
| `hospitalization-trends.monthly` | `HospitalizationAnalysis` — "Internações mensais" |
| `provider-trends.monthly` | `ProviderAnalysis` — "Custo mensal por prestador" |
| `provider-trends.network` | `ProviderAnalysis` — "Rede × reembolso" |
| `concentration.monthly` | `ConcentrationAnalysis` — "Concentração mensal" |
| `company-benchmark.table` | `CompanyBenchmark` |
| `family-timeline.relative` | `FamilyTimelineBlock` — "Custo por mês relativo" |
| `care-timeline.matrix` | `CareTimelineBlock` — "Fatura × coordenação por mês" |
| `ps-trends.monthly` | `PsItemAnalysis` — "Pronto-socorro mensal" |

**9 métricas** (KPIs de `ExecutiveKpis.tsx`): custo assistencial da janela, beneficiários
utilizantes, serviços realizados, episódios de internação, famílias utilizantes, custo por
utilizante, serviços por utilizante, custo por vida elegível, internações por mil vidas.

**1 entrada sem âncora:** `user-detail`. O escopo existe e é documentado, mas mora dentro de
`UserDetailDrawer` — abrir a gaveta de linhagem por cima da gaveta do beneficiário empilharia
dois painéis laterais. A entrada é alcançável pelo campo `related` de `top-users-window.table`.

Total: **25 entradas, 24 clicáveis**.

Três dos blocos clicáveis não são `ChartCard` (`top-users-window.table`,
`company-benchmark.table`, `care-timeline.matrix`). Para não duplicar a lógica de
acessibilidade em três lugares, o alvo é um componente próprio, `LineageAnchor`, que envolve
qualquer conteúdo; `ChartCard` e `Kpi` delegam a ele.

## Interface

### Toggle

No `AnalyticsHeader`, ao lado dos quatro seletores existentes. Botão com `aria-pressed`,
rótulo "Análise Databricks", ícone `fa-diagram-project`. Ligado, fixa uma faixa discreta no
topo da aba informando que o modo está ativo e como sair.

### Alvos

Com o modo ligado, cada bloco com `lineageId` ganha contorno tracejado e um selo "linhagem"
na borda superior esquerda. **O alvo clicável é o selo, não o bloco inteiro.**

Envolver o bloco num `role="button"` seria ARIA inválido: o `ChartCard` já contém o botão
"ver tabela" e o `TopUsersTable` contém `<select>` de ordenação — controle interativo dentro
de controle interativo. Além de inválido, o clique nesses controles borbulharia e abriria a
gaveta junto. O selo é um `<button>` de verdade, então Enter, Espaço e ordem de tabulação
funcionam sem código extra.

O selo fica à esquerda porque o canto superior direito do `ChartCard` já é do botão "ver
tabela" (`.chartCaption` usa `justify-content: space-between`).

Com o modo desligado, `LineageAnchor` devolve os filhos sem envoltório e sem atributo algum —
o DOM fica idêntico ao de hoje.

### Gaveta

Reaproveita as classes existentes em `SinistralidadeV2Tab.module.css` (`.drawer`,
`.drawerHeader`, `.drawerBody`, `.drawerList`) e fecha com `Escape`.

**Não move o foco ao abrir nem o restaura ao fechar**, ao contrário do `UserDetailDrawer.tsx`.
Aquele é modal e precisa levar o foco para dentro. Este é um painel de consulta que fica ao
lado enquanto a pessoa continua clicando nos blocos — mover o foco a cada seleção a tiraria
de onde está trabalhando. O selo que abriu a gaveta mantém o foco. (A versão anterior desta
seção mandava copiar o padrão de foco do drawer modal e, duas linhas abaixo, dizia "sem
prender foco"; as duas coisas não coexistem.)

**É não-modal, ao contrário de `UserDetailDrawer`.** Aquele tem overlay que captura clique
porque é uma tarefa focada. Esta precisa deixar o usuário clicar de um bloco a outro
comparando linhagens. Portanto: sem overlay, sem `aria-modal`, sem prender foco. Um `aside`
com `role="complementary"` e `aria-live="polite"` no corpo, para o leitor de tela anunciar a
troca de conteúdo. Em `max-width: 640px` — breakpoint que o arquivo já usa — vira folha
inferior de altura limitada, para não enterrar a página numa tela estreita.

**Posicionamento é responsabilidade do `.lineageDrawer`, não da classe `.drawer`
reaproveitada.** `.drawer` não tem posicionamento próprio: quem a coloca na lateral é o
`.drawerOverlay` do drawer modal (`position: fixed; inset: 0; justify-content: flex-end`).
Sem overlay, ela cairia no fluxo do documento. (Descoberto na implementação da Task 8; a
versão anterior desta seção mandava reaproveitar `.drawer` sem essa ressalva, e também dizia
que a folha inferior seria modal — seria preciso renderizar um overlay condicionado a media
query, o que CSS sozinho não faz. A folha inferior é não-modal como a variante lateral.)

Ordem do corpo: selo da camada (colorido por Silver/Gold/Mart/Controle) → fórmula → fontes,
cada uma com objeto, papel e colunas → filtros aplicados → notas → relacionados, clicáveis
para navegar dentro da própria gaveta.

## Permissão

1. **Servidor** — `scope=lineage` chama `rejectMdsAuth` antes de qualquer processamento.
   Papel `mds` recebe 403. Esta é a barreira que importa.
2. **Cliente** — o botão só renderiza para papel `full`. Observação: o `DashboardShell` já
   remove a seção inteira "Sinistralidade" da navegação quando `isMdsDashboard` é verdadeiro,
   então na prática o perfil MDS nunca alcança esta aba. O gate no botão é defesa em
   profundidade, não a proteção principal.
3. **Sem flag de ambiente.** As flags atuais do projeto vêm **ligadas** quando a variável não
   existe (`flag()` em `feature-flags.ts` retorna `true` para string vazia). Uma flag aqui
   daria falsa sensação de controle. O papel é o controle.

## Estados e erros

Usa `BlockState.tsx`, que já cobre os casos:

| Situação | Comportamento |
|---|---|
| Registro carregando | Botão desabilitado com indicador. Resposta é estática, então é rápido. |
| Registro falhou | Botão em estado de erro com "tentar novamente". O dashboard segue funcionando — linhagem é acessório e nunca derruba a visualização. |
| `lineageId` sem entrada | Gaveta abre com "linhagem não documentada para este bloco". Vai acontecer durante o desenvolvimento e não pode virar tela em branco. |
| Bloco em `409 blocked` | Linhagem **abre normalmente**. É o caso que mais justifica o recurso: o gráfico está vazio porque nenhum mês está fechado, e a gaveta mostra `sinistralidade_month_status_v2` como fonte do gate. |

Cache: `Cache-Control: private, max-age=3600` na resposta do escopo `lineage`.

## Versão do contrato

Sobe de `1.1.0` para `1.2.0`. Adição de escopo é mudança aditiva, e o precedente do projeto
é bumpar minor nesse caso (foi o que levou `1.0.0` a `1.1.0` quando entraram os 12 escopos
longitudinais).

O bump tem raio de alcance conhecido — quatro pontos precisam ser atualizados juntos, senão
a suíte quebra:

- `src/contracts/sinistralidade-v2.ts:3` — a constante `SINISTRALIDADE_CONTRACT_VERSION`.
- `tests/unit/sinistralidade-contract.test.ts:14` — asserção do valor.
- `tests/unit/sinistralidade-contract.test.ts:65` — `contract_version` no envelope de exemplo.
- `tests/unit/sinistralidade-serializers.test.ts:76` — asserção do envelope construído.

Nenhuma métrica publicada muda de significado, então não há nova versão principal.

## Testes

**Unitário — servidor** (`tests/unit/sinistralidade-lineage.test.ts`):
- Existem as 25 entradas esperadas, e todo `related` aponta para um `id` existente.
- Os 12 escopos longitudinais têm ao menos uma entrada com `id` prefixado pelo nome do escopo.
- Todo `object` declarado existe na constante `TABLES` de `query-runner.ts`. Pega nome de
  tabela digitado errado, que é o modo de falha mais provável do registro.
- `scope=lineage` responde 403 para papel `mds`.
- Nenhuma entrada tem `sources` vazio ou `columns` vazio.

**Unitário — contrato** (estende `tests/unit/sinistralidade-contract.test.ts`):
- `lineageRegistrySchema` valida o registro completo.
- Entrada malformada é rejeitada.

**E2E** (estende `tests/e2e/dashboard.spec.ts`):
- Modo desligado: cards não têm `role="button"`.
- Modo ligado: clicar num card abre a gaveta com o nome de tabela esperado.
- `Escape` fecha.
- Clicar num segundo card troca o conteúdo sem fechar a gaveta.

## Critérios de aceite

1. Usuário `full` liga o modo e clica em qualquer um dos 24 alvos; a gaveta mostra camada,
   fórmula, fontes com colunas e filtros.
2. Requisição de `scope=lineage` com credencial `mds` responde 403.
3. Um bloco com período bloqueado (`409`) ainda abre linhagem.
4. Com o modo desligado, o DOM dos cards é idêntico ao de hoje.
5. `npm run lint`, `npm run typecheck`, `npm test` e `npm run test:e2e` passam.
6. Nenhuma consulta ao Databricks é disparada pelo escopo `lineage`.

## Riscos

| Risco | Mitigação |
|---|---|
| Registro dessincroniza do SQL | Co-locação no mesmo arquivo + teste que confere objetos contra `TABLES` |
| 21 entradas escritas às pressas ficam genéricas | Puxar texto de `IMPLEMENTACAO.md` e dos `title` do Gold Preview em vez de redigir do zero |
| Gaveta não-modal confunde quem espera comportamento de modal | Faixa de aviso do modo ativo + botão de fechar explícito |
| Bundle cresce com o registro | Registro vem por rede sob demanda, não vai para o bundle |

## Contexto maior

Este é o sub-projeto **A** de três, decompostos em 2026-07-25:

- **A (este)** — inspetor de linhagem na Visão 360, que já é React e recebe o recurso com
  esforço baixo. Valida o formato do registro e a interface.
- **B** — reescrita da aba Preview Gold em React (KPIs, blocos B1–B8, filtros facetados,
  metodologia; Chart.js → SVG) e migração dos 4 gráficos `#AS01`–`#AS04` da Análise Sinistro,
  **repontados para a Gold**. Os 3 cards antes/depois da Análise Sinistro não precisam
  migrar: os blocos B6 e B7 do Gold Preview já recalculam a mesma metodologia sobre a Gold
  (`IMPACTO_PRE/POS`, `MADURO_PRE/POS` em `src/server/routes/gold-preview.ts`). Nasce já com
  linhagem, usando o registro validado em A.
- **C** — consolidação da navegação: Preview Gold assume o nome Análise Sinistro e a seção
  "Sinistralidade" fica com duas abas.

**Alerta para B:** repontar os 4 gráficos para a Gold **muda os números publicados**. A Gold
exclui `flag_data_suspeita`, resolve identidade por `person_key`/`family_key` em vez de
`codigo_usuario`+`cpf_titular`, e conta internação por `episode_key`. Cada delta precisa de
validação com o time de negócio antes da publicação.
