# Inspetor de Linhagem Databricks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um usuário do papel `full` ligue um modo "Análise Databricks" na aba Sinistralidade 360 e clique em qualquer gráfico ou KPI para ver, numa gaveta lateral, de quais tabelas e colunas do Databricks aquele número vem.

**Architecture:** O registro de linhagem é declarado no servidor, em constantes co-locadas com o SQL que descrevem, dentro de `src/server/sinistralidade/queries/*.ts`. Um agregador (`lineage.ts`) junta tudo e serve por `GET /api/sinistralidade/v2?scope=lineage`, sem tocar o Databricks. No cliente, um contexto React guarda o modo e o alvo ativo; `LineageAnchor` transforma blocos em alvos clicáveis e `LineageDrawer` renderiza a entrada.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5.9, Zod 4, Vitest 4 (ambiente `node`), Playwright 1.61.

**Spec:** `docs/superpowers/specs/2026-07-25-lineage-inspector-sinistralidade-360-design.md`

## Global Constraints

- Diretório de trabalho: `/Users/marcoruas/Documents/SANUS/api`. Todos os caminhos são relativos a ele.
- Nenhuma consulta ao Databricks no caminho do escopo `lineage`. Ele responde de memória.
- Todo texto de interface em português do Brasil.
- `formula` em linguagem de negócio. **Nunca** SQL literal em nenhuma entrada do registro.
- Todo `object` declarado em `sources` precisa existir em `TABLES` (`src/server/sinistralidade/query-runner.ts`). Há um teste que garante isso.
- O escopo `lineage` entra em `sinistralidadeScopeSchema`, **nunca** em `longitudinalScopeSchema` — o handler usa `isLongitudinalScope()` para rotear, e o caminho longitudinal exige `end_month`.
- Vitest roda com `environment: "node"` e só inclui `tests/unit/**/*.test.ts`. Não há jsdom: nenhum teste de componente React. Comportamento de cliente é verificado por Playwright.
- Versão do contrato sobe para `1.2.0` na Task 1 e todas as tasks seguintes assumem esse valor.
- Papel `mds` recebe 403 no escopo `lineage`.
- Commits em português, formato Conventional Commits (o projeto usa `commitlint`).

---

### Task 1: Contrato de linhagem e escopo `lineage`

**Files:**
- Modify: `src/contracts/sinistralidade-v2.ts:3` (constante de versão) e `:38-41` (enum de escopo); adiciona schemas no fim do arquivo
- Modify: `tests/unit/sinistralidade-contract.test.ts:14`, `:65`
- Modify: `tests/unit/sinistralidade-serializers.test.ts:76`
- Test: `tests/unit/sinistralidade-contract.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `lineageEntrySchema`, `lineageRegistrySchema`, `lineageLayerSchema`, `lineageSourceSchema`; tipos `LineageEntry`, `LineageSource`, `LineageRegistry`, `LineageLayer`; o valor `"lineage"` aceito por `sinistralidadeQuerySchema.scope`; `SINISTRALIDADE_CONTRACT_VERSION === "1.2.0"`.

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao fim de `tests/unit/sinistralidade-contract.test.ts`, e altere as três asserções de versão existentes de `"1.1.0"` para `"1.2.0"` (linhas 14 e 65 deste arquivo):

```ts
import {
  lineageEntrySchema,
  lineageRegistrySchema,
  sinistralidadeQuerySchema,
} from "../../src/contracts/sinistralidade-v2";

describe("contrato de linhagem 1.2.0", () => {
  const entradaValida = {
    id: "timeline.monthly",
    kind: "block" as const,
    label: "Evolução mensal",
    layer: "mart" as const,
    sources: [
      {
        object: "hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2",
        role: "fato principal",
        columns: ["month_key", "custo_assistencial_bruto"],
      },
    ],
    formula: "SUM(custo_assistencial_bruto) por month_key",
    filters: ["company_key do escopo do usuário"],
  };

  it("aceita uma entrada completa", () => {
    expect(lineageEntrySchema.parse(entradaValida).id).toBe("timeline.monthly");
  });

  it("rejeita entrada sem fontes", () => {
    expect(lineageEntrySchema.safeParse({ ...entradaValida, sources: [] }).success).toBe(false);
  });

  it("rejeita fonte sem colunas", () => {
    const semColunas = { ...entradaValida, sources: [{ ...entradaValida.sources[0], columns: [] }] };
    expect(lineageEntrySchema.safeParse(semColunas).success).toBe(false);
  });

  it("rejeita camada desconhecida", () => {
    expect(lineageEntrySchema.safeParse({ ...entradaValida, layer: "bronze_raw" }).success).toBe(false);
  });

  it("valida o registro completo", () => {
    const registro = {
      contract_version: "1.2.0",
      generated_at: "2026-07-25T00:00:00.000Z",
      entries: [entradaValida],
    };
    expect(lineageRegistrySchema.parse(registro).entries).toHaveLength(1);
  });

  it("aceita scope=lineage na querystring", () => {
    expect(sinistralidadeQuerySchema.parse({ scope: "lineage" }).scope).toBe("lineage");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/sinistralidade-contract.test.ts`
Expected: FAIL — `lineageEntrySchema` não é exportado; e as asserções de versão falham com `expected "1.1.0" to be "1.2.0"`.

- [ ] **Step 3: Subir a versão do contrato**

Em `src/contracts/sinistralidade-v2.ts`, linha 3:

```ts
export const SINISTRALIDADE_CONTRACT_VERSION = "1.2.0";
```

Em `tests/unit/sinistralidade-serializers.test.ts`, linha 76, troque a asserção:

```ts
    expect(envelope.contract_version).toBe("1.2.0");
```

- [ ] **Step 4: Adicionar `lineage` ao enum de escopo**

Em `src/contracts/sinistralidade-v2.ts`, substitua o bloco `sinistralidadeScopeSchema` (linhas 38-41):

```ts
// `lineage` é metadado: não é escopo longitudinal e não passa pelo gate de
// período. Declarar aqui, e não em longitudinalScopeSchema, é o que impede
// isLongitudinalScope() de roteá-lo para handleLongitudinal (que exigiria
// end_month e responderia 400).
export const sinistralidadeScopeSchema = z.enum([
  ...legacyScopeSchema.options,
  ...longitudinalScopeSchema.options,
  "lineage",
]);
```

- [ ] **Step 5: Adicionar os schemas de linhagem**

No fim de `src/contracts/sinistralidade-v2.ts`:

```ts
// ---- Linhagem Databricks (1.2.0) ----
// Metadado estático que descreve, por bloco visível e por KPI, de onde o
// número vem. Declarado no servidor, ao lado do SQL que ele descreve.

export const lineageLayerSchema = z.enum(["silver", "gold", "mart", "control"]);

export const lineageSourceSchema = z.object({
  object: z.string().min(1),
  role: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
});

export const lineageEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["block", "metric"]),
  label: z.string().min(1),
  layer: lineageLayerSchema,
  sources: z.array(lineageSourceSchema).min(1),
  formula: z.string().min(1),
  filters: z.array(z.string().min(1)),
  notes: z.array(z.string().min(1)).optional(),
  related: z.array(z.string().min(1)).optional(),
});

export const lineageRegistrySchema = z.object({
  contract_version: z.string(),
  generated_at: z.string(),
  entries: z.array(lineageEntrySchema).min(1),
});

export type LineageLayer = z.infer<typeof lineageLayerSchema>;
export type LineageSource = z.infer<typeof lineageSourceSchema>;
export type LineageEntry = z.infer<typeof lineageEntrySchema>;
export type LineageRegistry = z.infer<typeof lineageRegistrySchema>;
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/sinistralidade-contract.test.ts tests/unit/sinistralidade-serializers.test.ts`
Expected: PASS em todos.

- [ ] **Step 7: Confirmar que nada mais quebrou**

Run: `npm test && npm run typecheck`
Expected: PASS. Se algum outro teste ainda esperar `"1.1.0"`, atualize-o para `"1.2.0"` — o bump é intencional.

- [ ] **Step 8: Commit**

```bash
git add src/contracts/sinistralidade-v2.ts tests/unit/sinistralidade-contract.test.ts tests/unit/sinistralidade-serializers.test.ts
git commit -m "feat(sinistralidade): contrato 1.2.0 com schemas de linhagem e escopo lineage"
```

---

### Task 2: Agregador de linhagem e primeiras entradas (custo e uso)

**Files:**
- Create: `src/server/sinistralidade/lineage.ts`
- Modify: `src/server/sinistralidade/queries/timeline.ts` (adiciona constante após `TIMELINE_UNITS`)
- Modify: `src/server/sinistralidade/queries/event-mix.ts` (após `EVENT_MIX_UNITS`)
- Modify: `src/server/sinistralidade/queries/concentration.ts` (após `CONCENTRATION_UNITS` e `BENCHMARK_UNITS`)
- Test: `tests/unit/sinistralidade-lineage.test.ts`

**Interfaces:**
- Consumes: `LineageEntry`, `lineageRegistrySchema` (Task 1); `TABLES` de `src/server/sinistralidade/query-runner.ts`.
- Produces: `TIMELINE_LINEAGE`, `EVENT_MIX_LINEAGE`, `CONCENTRATION_LINEAGE`, `BENCHMARK_LINEAGE` — todas do tipo `LineageEntry[]`; e `lineageRegistry(): LineageRegistry` exportada de `src/server/sinistralidade/lineage.ts`.

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/unit/sinistralidade-lineage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { lineageRegistry } from "../../src/server/sinistralidade/lineage";
import { lineageRegistrySchema } from "../../src/contracts/sinistralidade-v2";
import { TABLES } from "../../src/server/sinistralidade/query-runner";

const registro = lineageRegistry();

describe("registro de linhagem", () => {
  it("valida contra o schema do contrato", () => {
    expect(lineageRegistrySchema.safeParse(registro).success).toBe(true);
  });

  it("não repete ids", () => {
    const ids = registro.entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("só referencia objetos conhecidos em TABLES", () => {
    const conhecidos = new Set<string>(Object.values(TABLES));
    const desconhecidos = registro.entries
      .flatMap((entry) => entry.sources.map((source) => source.object))
      .filter((object) => !conhecidos.has(object));
    expect(desconhecidos).toEqual([]);
  });

  it("tem entradas para os blocos de custo e uso", () => {
    const ids = registro.entries.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "timeline.monthly",
        "timeline.competency",
        "event-mix.cost",
        "concentration.monthly",
        "company-benchmark.table",
      ]),
    );
  });

  it("todo related aponta para um id existente", () => {
    const ids = new Set(registro.entries.map((entry) => entry.id));
    const quebrados = registro.entries
      .flatMap((entry) => entry.related ?? [])
      .filter((related) => !ids.has(related));
    expect(quebrados).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: FAIL — `Cannot find module '../../src/server/sinistralidade/lineage'`.

- [ ] **Step 3: Declarar a linhagem do escopo `timeline`**

Em `src/server/sinistralidade/queries/timeline.ts`, logo depois do bloco `TIMELINE_UNITS` (que termina na linha 22), insira:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

// Linhagem dos dois blocos que este escopo desenha. Mora aqui, ao lado do SQL,
// para que uma mudança de consulta não passe sem revisar a documentação.
export const TIMELINE_LINEAGE: LineageEntry[] = [
  {
    id: "timeline.monthly",
    kind: "block",
    label: "Evolução mensal por data de atendimento",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato principal",
        columns: [
          "month_key",
          "custo_assistencial_bruto",
          "utilizantes",
          "familias_utilizantes",
          "quantidade_servicos",
          "linhas_cobranca",
          "vidas_elegiveis",
          "custo_por_vida_elegivel",
          "freshness",
        ],
      },
      {
        object: TABLES.martInternacaoMes,
        role: "episódios de internação do mês",
        columns: ["month_key", "episodios_internacao"],
      },
      {
        object: TABLES.monthStatus,
        role: "gate de fechamento do período",
        columns: ["company_key", "month_key", "status", "updated_at"],
      },
    ],
    formula:
      "Uma linha por mês da janela. Custo = SUM(custo_assistencial_bruto). Variação mês a mês e ano a ano calculadas sobre o custo; média móvel de 3 meses.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "A série é densa: todo mês da janela aparece. Mês sem cobertura vem com métricas null, nunca zero, e has_data = false.",
      "Mês fora dos meses aprovados aparece com included = false e sem métricas.",
    ],
    related: ["timeline.competency", "kpi.gross_cost"],
  },
  {
    id: "timeline.competency",
    kind: "block",
    label: "Custo por competência de faturamento",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "fato assistencial",
        columns: [
          "competencia_cobranca",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "company_key",
          "flag_data_suspeita",
        ],
      },
    ],
    formula:
      "SUM(custo_assistencial_bruto) agrupado por competencia_cobranca convertida de dd/MM/yyyy para yyyy-MM.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "NOT flag_data_suspeita",
      "competências dentro da janela selecionada",
    ],
    notes: [
      "Responde 'quanto foi faturado no mês', não 'quanto foi atendido no mês'. É por isso que difere da série por data de atendimento.",
      "Mês sem faturamento na competência vem null, nunca zero.",
    ],
    related: ["timeline.monthly"],
  },
];
```

- [ ] **Step 4: Declarar a linhagem do escopo `event-mix`**

Em `src/server/sinistralidade/queries/event-mix.ts`, depois de `EVENT_MIX_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const EVENT_MIX_LINEAGE: LineageEntry[] = [
  {
    id: "event-mix.cost",
    kind: "block",
    label: "Composição do custo por tipo de evento",
    layer: "mart",
    sources: [
      {
        object: TABLES.martEventoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "tipo_evento",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "linhas_cobranca",
          "utilizantes",
          "episodios_internacao",
          "participacao_custo_mes",
        ],
      },
    ],
    formula:
      "Custo e volume por tipo_evento em cada mês. Participação do período = custo do evento ÷ custo total da janela.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "Linha sem tipo_evento preenchido aparece como 'Sem classificação' em vez de ser descartada.",
      "Empate de custo é desempatado pelo nome do evento, para a ordem ser estável entre execuções.",
    ],
    related: ["timeline.monthly"],
  },
];
```

- [ ] **Step 5: Declarar a linhagem de `concentration` e `company-benchmark`**

Em `src/server/sinistralidade/queries/concentration.ts`, depois de `CONCENTRATION_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const CONCENTRATION_LINEAGE: LineageEntry[] = [
  {
    id: "concentration.monthly",
    kind: "block",
    label: "Concentração mensal do custo em beneficiários",
    layer: "mart",
    sources: [
      {
        object: TABLES.martConcentracaoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "pessoas_utilizantes",
          "custo_total",
          "participacao_top1",
          "participacao_top5",
          "participacao_top10",
          "participacao_top10pct",
          "pessoas_para_50pct",
          "pessoas_para_80pct",
          "top10_recorrentes_mes_anterior",
        ],
      },
    ],
    formula:
      "Participação acumulada do custo detida pelos maiores utilizantes de cada mês, e quantas pessoas são necessárias para somar 50% e 80% do custo.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "Só agregados. Nenhuma identificação individual sai deste bloco.",
      "top10_recorrentes_mes_anterior mede persistência: quantos do Top 10 do mês já estavam no Top 10 do mês anterior.",
    ],
    related: ["top-users-window.table"],
  },
];
```

E depois de `BENCHMARK_UNITS`, no mesmo arquivo:

```ts
export const BENCHMARK_LINEAGE: LineageEntry[] = [
  {
    id: "company-benchmark.table",
    kind: "block",
    label: "Comparação entre empresas",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato principal, agregado por empresa",
        columns: [
          "company_key",
          "month_key",
          "custo_assistencial_bruto",
          "utilizantes",
          "quantidade_servicos",
          "linhas_cobranca",
          "vidas_elegiveis",
        ],
      },
      {
        object: TABLES.dimCompany,
        role: "nome canônico da empresa",
        columns: ["company_key", "nome_empresa_canonico"],
      },
    ],
    formula:
      "Uma linha por empresa: custo somado na janela, participação sobre o total do escopo, custo por utilizante e serviços por utilizante.",
    filters: [
      "todas as empresas do escopo do usuário — este bloco ignora o filtro de empresa da tela",
      "meses aprovados pelo gate agregado: closed só quando toda empresa com registro no mês está fechada",
    ],
    notes: [
      "Não existe mart próprio de benchmark: ele é derivado do mart mensal.",
      "Custo por vida elegível só aparece quando todos os meses da janela têm denominador; caso contrário o estado é not_comparable e o campo fica null.",
      "O somatório de utilizantes é por mês: a mesma pessoa em dois meses conta duas vezes. Não é população distinta.",
    ],
    related: ["timeline.monthly"],
  },
];
```

- [ ] **Step 6: Criar o agregador**

Create `src/server/sinistralidade/lineage.ts`:

```ts
// Registro de linhagem da Sinistralidade 360.
// Só agrega: cada entrada é declarada no arquivo da query que ela descreve,
// em src/server/sinistralidade/queries/. Este módulo não conhece SQL nem
// consulta o Databricks.

import { SINISTRALIDADE_CONTRACT_VERSION, type LineageEntry, type LineageRegistry } from "../../contracts/sinistralidade-v2";
import { CONCENTRATION_LINEAGE, BENCHMARK_LINEAGE } from "./queries/concentration";
import { EVENT_MIX_LINEAGE } from "./queries/event-mix";
import { TIMELINE_LINEAGE } from "./queries/timeline";

const ENTRIES: LineageEntry[] = [
  ...TIMELINE_LINEAGE,
  ...EVENT_MIX_LINEAGE,
  ...CONCENTRATION_LINEAGE,
  ...BENCHMARK_LINEAGE,
];

export function lineageRegistry(): LineageRegistry {
  return {
    contract_version: SINISTRALIDADE_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    entries: ENTRIES,
  };
}
```

- [ ] **Step 7: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: PASS nos 5 testes.

- [ ] **Step 8: Commit**

```bash
git add src/server/sinistralidade/lineage.ts src/server/sinistralidade/queries/timeline.ts src/server/sinistralidade/queries/event-mix.ts src/server/sinistralidade/queries/concentration.ts tests/unit/sinistralidade-lineage.test.ts
git commit -m "feat(sinistralidade): registro de linhagem para custo, evento e concentração"
```

---

### Task 3: Linhagem dos escopos de procedimento, internação, prestador, PS e pessoa

**Files:**
- Modify: `src/server/sinistralidade/queries/procedures.ts` (após `PROCEDURE_UNITS`)
- Modify: `src/server/sinistralidade/queries/hospitalizations.ts` (após `HOSPITALIZATION_UNITS`)
- Modify: `src/server/sinistralidade/queries/providers.ts` (após `PROVIDER_UNITS`)
- Modify: `src/server/sinistralidade/queries/rankings.ts` (após `TOP_USERS_UNITS` e após `USER_DETAIL_UNITS`)
- Modify: `src/server/sinistralidade/queries/family-care.ts` (após `FAMILY_UNITS`, `CARE_UNITS` e `PS_UNITS`)
- Modify: `src/server/sinistralidade/lineage.ts` (importar e concatenar as novas constantes)
- Test: `tests/unit/sinistralidade-lineage.test.ts`

**Interfaces:**
- Consumes: `LineageEntry` (Task 1); `lineageRegistry()` e o padrão de constante estabelecido na Task 2.
- Produces: `PROCEDURE_LINEAGE`, `HOSPITALIZATION_LINEAGE`, `PROVIDER_LINEAGE`, `TOP_USERS_LINEAGE`, `USER_DETAIL_LINEAGE`, `FAMILY_LINEAGE`, `CARE_LINEAGE`, `PS_LINEAGE` — todas `LineageEntry[]`.

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao `describe` existente em `tests/unit/sinistralidade-lineage.test.ts`:

```ts
  it("tem os 15 blocos clicáveis e as 9 métricas previstos", () => {
    const ids = registro.entries.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "timeline.monthly",
        "timeline.competency",
        "event-mix.cost",
        "top-users-window.table",
        "procedure-trends.pareto",
        "procedure-trends.scatter",
        "procedure-trends.monthly",
        "hospitalization-trends.monthly",
        "provider-trends.monthly",
        "provider-trends.network",
        "concentration.monthly",
        "company-benchmark.table",
        "family-timeline.relative",
        "care-timeline.matrix",
        "ps-trends.monthly",
        "user-detail",
      ]),
    );
  });

  it("cobre os 12 escopos longitudinais", () => {
    const escopos = [
      "timeline",
      "event-mix",
      "top-users-window",
      "user-detail",
      "procedure-trends",
      "hospitalization-trends",
      "provider-trends",
      "concentration",
      "company-benchmark",
      "family-timeline",
      "care-timeline",
      "ps-trends",
    ];
    const semEntrada = escopos.filter(
      (escopo) => !registro.entries.some((entry) => entry.id === escopo || entry.id.startsWith(`${escopo}.`)),
    );
    expect(semEntrada).toEqual([]);
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: FAIL — o array não contém `top-users-window.table` nem os demais ids novos.

- [ ] **Step 3: Declarar a linhagem de procedimentos**

Em `src/server/sinistralidade/queries/procedures.ts`, depois de `PROCEDURE_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

const PROCEDURE_SOURCES = [
  {
    object: TABLES.martProcedimentoMes,
    role: "fato principal",
    columns: [
      "procedimento_key",
      "month_key",
      "custo_assistencial_bruto",
      "quantidade_servicos",
      "linhas_cobranca",
      "utilizantes",
    ],
  },
];

const PROCEDURE_FILTERS = [
  "company_key do escopo do usuário, aplicado no SQL",
  "meses aprovados pelo gate de fechamento",
  "quando há filtro de tipo de evento, os códigos vêm de gold_sinistro_evento_v2",
];

export const PROCEDURE_LINEAGE: LineageEntry[] = [
  {
    id: "procedure-trends.pareto",
    kind: "block",
    label: "Pareto de procedimentos por custo",
    layer: "mart",
    sources: PROCEDURE_SOURCES,
    formula:
      "Procedimentos ordenados por SUM(custo_assistencial_bruto) na janela, com participação acumulada sobre o custo total.",
    filters: PROCEDURE_FILTERS,
    notes: ["Mostra quantos procedimentos concentram a maior parte do custo."],
    related: ["procedure-trends.scatter", "procedure-trends.monthly"],
  },
  {
    id: "procedure-trends.scatter",
    kind: "block",
    label: "Dispersão: volume contra custo médio",
    layer: "mart",
    sources: PROCEDURE_SOURCES,
    formula:
      "Cada ponto é um procedimento: eixo de volume = SUM(quantidade_servicos); eixo de custo médio = SUM(custo_assistencial_bruto) ÷ SUM(quantidade_servicos).",
    filters: PROCEDURE_FILTERS,
    notes: [
      "Separa frequência de severidade: muito volume com custo médio baixo é um problema diferente de pouco volume com custo médio alto.",
    ],
    related: ["procedure-trends.pareto"],
  },
  {
    id: "procedure-trends.monthly",
    kind: "block",
    label: "Custo mensal por procedimento",
    layer: "mart",
    sources: PROCEDURE_SOURCES,
    formula:
      "Série mensal de SUM(custo_assistencial_bruto) e SUM(quantidade_servicos) para os procedimentos do recorte.",
    filters: PROCEDURE_FILTERS,
    related: ["procedure-trends.pareto"],
  },
];
```

E importe `TABLES` no arquivo se ainda não estiver importado (ele já está, usado no SQL).

- [ ] **Step 4: Declarar a linhagem de internações**

Em `src/server/sinistralidade/queries/hospitalizations.ts`, depois de `HOSPITALIZATION_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const HOSPITALIZATION_LINEAGE: LineageEntry[] = [
  {
    id: "hospitalization-trends.monthly",
    kind: "block",
    label: "Internações mensais e saúde mental",
    layer: "mart",
    sources: [
      {
        object: TABLES.martInternacaoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "saude_mental",
          "episodios_internacao",
          "utilizantes",
          "custo_total",
        ],
      },
      {
        object: TABLES.martInternacaoGrupoMes,
        role: "quebra por acomodação",
        columns: ["month_key", "acomodacao_internacao", "episodios_internacao", "utilizantes"],
      },
      {
        object: TABLES.martPrestadorMes,
        role: "prestadores que internaram",
        columns: ["month_key", "prestador_key", "prestador_label", "episodios_internacao", "utilizantes"],
      },
    ],
    formula:
      "Episódios = COUNT(DISTINCT episode_key) já consolidado no mart. Custo médio por episódio = custo_total ÷ episodios_internacao.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
      "quando o filtro de saúde mental está ativo, só episódios classificados",
    ],
    notes: [
      "Internação conta ADMISSÕES, não diárias: o episode_key inclui a data de atendimento, e o episódio é atribuído ao mês inicial.",
      "A classificação de saúde mental é aplicada no grão do episódio, não da linha de cobrança.",
    ],
    related: ["timeline.monthly"],
  },
];
```

- [ ] **Step 5: Declarar a linhagem de prestadores**

Em `src/server/sinistralidade/queries/providers.ts`, depois de `PROVIDER_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

const PROVIDER_SOURCES = [
  {
    object: TABLES.martPrestadorMes,
    role: "fato principal",
    columns: [
      "prestador_key",
      "prestador_label",
      "tipo_prestador",
      "especialidade_principal",
      "month_key",
      "custo_assistencial_bruto",
      "quantidade_servicos",
      "utilizantes",
      "episodios_internacao",
      "reembolso",
    ],
  },
];

const PROVIDER_FILTERS = [
  "company_key do escopo do usuário, aplicado no SQL",
  "meses aprovados pelo gate de fechamento",
  "filtros opcionais de rede/reembolso e de especialidade",
];

export const PROVIDER_LINEAGE: LineageEntry[] = [
  {
    id: "provider-trends.monthly",
    kind: "block",
    label: "Custo mensal por prestador",
    layer: "mart",
    sources: PROVIDER_SOURCES,
    formula:
      "Prestadores ordenados por SUM(custo_assistencial_bruto) na janela; ticket médio = custo ÷ quantidade_servicos.",
    filters: PROVIDER_FILTERS,
    notes: ["prestador_key é a identidade canônica; prestador_label é o nome exibido."],
    related: ["provider-trends.network"],
  },
  {
    id: "provider-trends.network",
    kind: "block",
    label: "Rede contra reembolso",
    layer: "mart",
    sources: PROVIDER_SOURCES,
    formula:
      "Custo e serviços por mês, separados pela marcação de reembolso. Share de reembolso = custo em reembolso ÷ custo do mês.",
    filters: PROVIDER_FILTERS,
    notes: [
      "Share de reembolso é proxy de vazamento de rede: gasto fora da rede credenciada, que costuma custar mais.",
    ],
    related: ["provider-trends.monthly"],
  },
];
```

- [ ] **Step 6: Declarar a linhagem de ranking e detalhe individual**

Em `src/server/sinistralidade/queries/rankings.ts`, depois de `TOP_USERS_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const TOP_USERS_LINEAGE: LineageEntry[] = [
  {
    id: "top-users-window.table",
    kind: "block",
    label: "Maiores utilizantes da janela",
    layer: "mart",
    sources: [
      {
        object: TABLES.martPessoaMes,
        role: "fato principal",
        columns: [
          "person_key",
          "month_key",
          "faixa_etaria",
          "parentesco",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "linhas_cobranca",
          "episodios_internacao",
        ],
      },
    ],
    formula:
      "Pessoas ordenadas pelo critério escolhido (custo, serviços, internações ou crescimento) somado na janela. A posição na janela anterior vem da mesma consulta deslocada.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
      "exige permissão de ranking individual",
    ],
    notes: [
      "A identidade é o person_key opaco: nome e CPF nunca saem da camada controlada.",
      "Todo acesso a este bloco é auditado no servidor.",
    ],
    related: ["user-detail", "concentration.monthly"],
  },
];
```

E depois de `USER_DETAIL_UNITS`, no mesmo arquivo:

```ts
export const USER_DETAIL_LINEAGE: LineageEntry[] = [
  {
    id: "user-detail",
    kind: "block",
    label: "Detalhe individual do beneficiário",
    layer: "gold",
    sources: [
      {
        object: TABLES.martPessoaMes,
        role: "série mensal da pessoa",
        columns: [
          "person_key",
          "month_key",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "linhas_cobranca",
        ],
      },
      {
        object: TABLES.gold,
        role: "composição por evento, procedimento, prestador e internação",
        columns: [
          "person_key",
          "month_key",
          "tipo_evento",
          "descricao_procedimento",
          "prestador",
          "flag_internacao",
          "flag_data_suspeita",
        ],
      },
    ],
    formula:
      "Recorte da janela para uma única pessoa: série mensal, composição por evento, dez principais procedimentos, dez principais prestadores e internações do período.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "NOT flag_data_suspeita",
      "exige permissão de detalhe individual",
    ],
    notes: [
      "Este bloco não tem botão de linhagem próprio: ele vive dentro da gaveta do beneficiário. Chegue aqui pelo bloco de maiores utilizantes.",
      "Nenhum CID é exposto: a exposição de diagnóstico aguarda aprovação clínica.",
      "A resposta é servida com Cache-Control: no-store e todo acesso é auditado, inclusive tentativa sem resultado.",
    ],
    related: ["top-users-window.table"],
  },
];
```

- [ ] **Step 7: Declarar a linhagem de família, coordenação e PS**

Em `src/server/sinistralidade/queries/family-care.ts`, depois de `FAMILY_UNITS`:

```ts
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const FAMILY_LINEAGE: LineageEntry[] = [
  {
    id: "family-timeline.relative",
    kind: "block",
    label: "Custo por mês relativo à entrada da família",
    layer: "mart",
    sources: [
      {
        object: TABLES.martFamiliaRelativo,
        role: "fato principal",
        columns: [
          "company_key",
          "mes_relativo",
          "familias",
          "pessoas_utilizantes",
          "linhas_cobranca",
          "custo_assistencial_bruto",
        ],
      },
    ],
    formula:
      "O eixo não é o calendário: é o mês relativo à entrada do titular. Mês 0 é a entrada; negativos são anteriores.",
    filters: ["company_key do escopo do usuário, aplicado no SQL"],
    notes: [
      "A entrada familiar é derivada do snapshot atual de elegibilidade, não de histórico retroativo.",
      "Dependentes sem ponte com o titular não estão associados: vw_beneficiarios não expõe essa identidade na origem.",
    ],
    related: ["care-timeline.matrix"],
  },
];
```

Depois de `CARE_UNITS`, no mesmo arquivo:

```ts
export const CARE_LINEAGE: LineageEntry[] = [
  {
    id: "care-timeline.matrix",
    kind: "block",
    label: "Fatura contra coordenação por mês",
    layer: "mart",
    sources: [
      {
        object: TABLES.martCoordenacaoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "utilizou_plano",
          "teve_coordenacao",
          "pessoas",
          "familias",
          "linhas_cobranca",
        ],
      },
      {
        object: TABLES.martCare,
        role: "quebra demográfica da matriz",
        columns: ["company_key", "month_key", "dimensao", "valor", "utilizou_plano", "teve_coordenacao"],
      },
    ],
    formula:
      "Matriz de quatro quadrantes por mês: usou o plano × teve coordenação. Cada célula conta pessoas e famílias.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
      "no perfil MDS, grupos pequenos são suprimidos",
    ],
    notes: [
      "A ponte com coordenação usa empresa e CPF do titular, sem expor CPF: cobre contatos digitais DO TITULAR.",
      "Dependente atendido digitalmente não casa com o titular e cai fora do quadrante coordenado.",
    ],
    related: ["family-timeline.relative"],
  },
];
```

Depois de `PS_UNITS`, no mesmo arquivo:

```ts
export const PS_LINEAGE: LineageEntry[] = [
  {
    id: "ps-trends.monthly",
    kind: "block",
    label: "Pronto-socorro ao longo do tempo",
    layer: "mart",
    sources: [
      {
        object: TABLES.martPsItemMes,
        role: "itens consumidos no pacote de PS",
        columns: [
          "month_key",
          "procedimento_key",
          "descricao_comercial",
          "grupo_comercial",
          "quantidade_servicos",
          "custo_assistencial_bruto",
        ],
      },
      {
        object: TABLES.martPsEpisode,
        role: "contagem de episódios de PS",
        columns: ["month_key", "episode_key"],
      },
    ],
    formula:
      "Série mensal de custo e serviços dos itens de PS, e COUNT(DISTINCT episode_key) para o número de episódios.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "O episódio canônico associa pessoa, conta, autorização, data e prestador — é o que evita contar o mesmo atendimento várias vezes.",
    ],
    related: ["hospitalization-trends.monthly"],
  },
];
```

- [ ] **Step 8: Ligar tudo no agregador**

Substitua o bloco de imports e a constante `ENTRIES` em `src/server/sinistralidade/lineage.ts`:

```ts
import { SINISTRALIDADE_CONTRACT_VERSION, type LineageEntry, type LineageRegistry } from "../../contracts/sinistralidade-v2";
import { CONCENTRATION_LINEAGE, BENCHMARK_LINEAGE } from "./queries/concentration";
import { EVENT_MIX_LINEAGE } from "./queries/event-mix";
import { CARE_LINEAGE, FAMILY_LINEAGE, PS_LINEAGE } from "./queries/family-care";
import { HOSPITALIZATION_LINEAGE } from "./queries/hospitalizations";
import { PROCEDURE_LINEAGE } from "./queries/procedures";
import { PROVIDER_LINEAGE } from "./queries/providers";
import { TOP_USERS_LINEAGE, USER_DETAIL_LINEAGE } from "./queries/rankings";
import { TIMELINE_LINEAGE } from "./queries/timeline";

const ENTRIES: LineageEntry[] = [
  ...TIMELINE_LINEAGE,
  ...EVENT_MIX_LINEAGE,
  ...TOP_USERS_LINEAGE,
  ...USER_DETAIL_LINEAGE,
  ...PROCEDURE_LINEAGE,
  ...HOSPITALIZATION_LINEAGE,
  ...PROVIDER_LINEAGE,
  ...CONCENTRATION_LINEAGE,
  ...BENCHMARK_LINEAGE,
  ...FAMILY_LINEAGE,
  ...CARE_LINEAGE,
  ...PS_LINEAGE,
];
```

- [ ] **Step 9: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts && npm run typecheck`
Expected: PASS. Se `só referencia objetos conhecidos em TABLES` falhar, o nome de tabela digitado está errado — corrija usando a chave de `TABLES`, nunca uma string literal.

- [ ] **Step 10: Commit**

```bash
git add src/server/sinistralidade/lineage.ts src/server/sinistralidade/queries/ tests/unit/sinistralidade-lineage.test.ts
git commit -m "feat(sinistralidade): linhagem de procedimento, internação, prestador, pessoa, família e PS"
```

---

### Task 4: Entradas de linhagem dos 9 KPIs executivos

**Files:**
- Create: `src/server/sinistralidade/queries/kpis-lineage.ts`
- Modify: `src/server/sinistralidade/lineage.ts`
- Test: `tests/unit/sinistralidade-lineage.test.ts`

**Interfaces:**
- Consumes: `LineageEntry` (Task 1); `TABLES`.
- Produces: `KPI_LINEAGE: LineageEntry[]` com os ids `kpi.gross_cost`, `kpi.utilizers`, `kpi.service_quantity`, `kpi.hospitalization_episodes`, `kpi.utilizing_families`, `kpi.cost_per_utilizer`, `kpi.services_per_utilizer`, `kpi.cost_per_eligible_life`, `kpi.hospitalizations_per_thousand_lives`.

**Nota de posicionamento:** as entradas de KPI vão num arquivo próprio, e não em `timeline.ts`, porque descrevem os agregados de janela que `ExecutiveKpis.tsx` renderiza — não a série mensal. O arquivo fica em `queries/` para manter a vizinhança com a consulta que produz os números.

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao `describe` em `tests/unit/sinistralidade-lineage.test.ts`:

```ts
  it("tem as 9 métricas de KPI, todas kind=metric", () => {
    const metricas = registro.entries.filter((entry) => entry.kind === "metric");
    expect(metricas.map((entry) => entry.id).sort()).toEqual([
      "kpi.cost_per_eligible_life",
      "kpi.cost_per_utilizer",
      "kpi.gross_cost",
      "kpi.hospitalization_episodes",
      "kpi.hospitalizations_per_thousand_lives",
      "kpi.service_quantity",
      "kpi.services_per_utilizer",
      "kpi.utilizers",
      "kpi.utilizing_families",
    ]);
  });

  it("tem 25 entradas no total", () => {
    expect(registro.entries).toHaveLength(25);
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: FAIL — `expected [] to deeply equal [ 'kpi.cost_per_eligible_life', ... ]` e `expected 16 to be 25`.

- [ ] **Step 3: Escrever as entradas de KPI**

Create `src/server/sinistralidade/queries/kpis-lineage.ts`:

```ts
// Linhagem dos KPIs executivos da janela (ExecutiveKpis.tsx).
// Todos são agregados calculados em JavaScript sobre o resultado do escopo
// `timeline`; nenhum deles tem consulta própria. Por isso as fontes repetem as
// do bloco timeline.monthly, mas a fórmula é a do agregado de janela.

import type { LineageEntry } from "../../../contracts/sinistralidade-v2";
import { TABLES } from "../query-runner";

const MART_MONTH = {
  object: TABLES.martMonth,
  role: "fato mensal somado na janela",
  columns: [
    "month_key",
    "custo_assistencial_bruto",
    "quantidade_servicos",
    "utilizantes",
    "vidas_elegiveis",
  ],
};

const MART_PESSOA = {
  object: TABLES.martPessoaMes,
  role: "identidade distinta na janela",
  columns: ["company_key", "month_key", "person_key", "family_key"],
};

const MART_INTERNACAO = {
  object: TABLES.martInternacaoMes,
  role: "episódios de internação",
  columns: ["month_key", "episodios_internacao"],
};

const FILTROS = [
  "company_key do escopo do usuário, aplicado no SQL",
  "somente meses aprovados pelo gate e com dado observado",
];

const NOTA_JANELA =
  "Soma apenas os meses incluídos na janela. Mês sem cobertura não entra no numerador nem no denominador.";

const NOTA_DENOMINADOR =
  "Só tem valor quando TODOS os meses incluídos têm snapshot de elegibilidade contemporâneo. Caso contrário o estado é not_comparable e o KPI exibe 'Denominador indisponível' — nunca um número aproximado.";

export const KPI_LINEAGE: LineageEntry[] = [
  {
    id: "kpi.gross_cost",
    kind: "metric",
    label: "Custo assistencial (janela)",
    layer: "mart",
    sources: [MART_MONTH],
    formula: "SUM(custo_assistencial_bruto) dos meses incluídos.",
    filters: FILTROS,
    notes: [NOTA_JANELA, "É custo bruto: não desconta coparticipação."],
    related: ["timeline.monthly"],
  },
  {
    id: "kpi.utilizers",
    kind: "metric",
    label: "Beneficiários utilizantes",
    layer: "mart",
    sources: [MART_PESSOA],
    formula: "COUNT(DISTINCT person_key) sobre todos os meses incluídos, de uma vez.",
    filters: FILTROS,
    notes: [
      "Não é a soma dos utilizantes mensais. A mesma pessoa em três meses conta uma vez aqui e três vezes na soma mensal.",
      "Quem não usou o plano não está na base: este não é o total de vidas.",
    ],
    related: ["kpi.cost_per_utilizer", "top-users-window.table"],
  },
  {
    id: "kpi.service_quantity",
    kind: "metric",
    label: "Serviços realizados",
    layer: "mart",
    sources: [MART_MONTH],
    formula: "SUM(quantidade_servicos) dos meses incluídos.",
    filters: FILTROS,
    notes: [NOTA_JANELA],
    related: ["kpi.services_per_utilizer"],
  },
  {
    id: "kpi.hospitalization_episodes",
    kind: "metric",
    label: "Episódios de internação",
    layer: "mart",
    sources: [MART_INTERNACAO],
    formula: "SUM(episodios_internacao) dos meses incluídos.",
    filters: FILTROS,
    notes: [
      "Conta ADMISSÕES, não diárias. O episódio é atribuído ao mês em que começou.",
    ],
    related: ["hospitalization-trends.monthly"],
  },
  {
    id: "kpi.utilizing_families",
    kind: "metric",
    label: "Famílias utilizantes",
    layer: "mart",
    sources: [MART_PESSOA],
    formula: "COUNT(DISTINCT family_key) sobre todos os meses incluídos, de uma vez.",
    filters: FILTROS,
    notes: [
      "family_key é o titular normalizado dentro da empresa.",
      "Dependente sem ponte com o titular não é associado à família na origem.",
    ],
    related: ["family-timeline.relative"],
  },
  {
    id: "kpi.cost_per_utilizer",
    kind: "metric",
    label: "Custo por utilizante",
    layer: "mart",
    sources: [MART_MONTH, MART_PESSOA],
    formula: "SUM(custo_assistencial_bruto) ÷ COUNT(DISTINCT person_key) na janela.",
    filters: FILTROS,
    notes: [
      "Normaliza pelo número de pessoas que USARAM. Não é per capita: quem não usou não está no denominador.",
      "Alta pode significar severidade ou mix pior; queda, mix mais leve.",
    ],
    related: ["kpi.utilizers", "kpi.cost_per_eligible_life"],
  },
  {
    id: "kpi.services_per_utilizer",
    kind: "metric",
    label: "Serviços por utilizante",
    layer: "mart",
    sources: [MART_MONTH, MART_PESSOA],
    formula: "SUM(quantidade_servicos) ÷ COUNT(DISTINCT person_key) na janela.",
    filters: FILTROS,
    notes: ["Mede intensidade de uso por pessoa que usou."],
    related: ["kpi.service_quantity"],
  },
  {
    id: "kpi.cost_per_eligible_life",
    kind: "metric",
    label: "Custo por vida elegível",
    layer: "mart",
    sources: [MART_MONTH],
    formula: "SUM(custo_assistencial_bruto) ÷ SUM(vidas_elegiveis) dos meses incluídos.",
    filters: FILTROS,
    notes: [
      NOTA_DENOMINADOR,
      "Este é o per capita de verdade, ao contrário do custo por utilizante.",
      "O primeiro snapshot de elegibilidade é de 2026-07-16; meses anteriores não têm denominador e não podem ser reconstruídos retroativamente.",
    ],
    related: ["kpi.cost_per_utilizer", "timeline.monthly"],
  },
  {
    id: "kpi.hospitalizations_per_thousand_lives",
    kind: "metric",
    label: "Internações por mil vidas",
    layer: "mart",
    sources: [MART_INTERNACAO, MART_MONTH],
    formula: "SUM(episodios_internacao) ÷ SUM(vidas_elegiveis) × 1.000 nos meses incluídos.",
    filters: FILTROS,
    notes: [NOTA_DENOMINADOR, "Indicador de severidade populacional."],
    related: ["kpi.hospitalization_episodes", "kpi.cost_per_eligible_life"],
  },
];
```

- [ ] **Step 4: Ligar no agregador**

Em `src/server/sinistralidade/lineage.ts`, adicione o import e a última linha do array:

```ts
import { KPI_LINEAGE } from "./queries/kpis-lineage";
```

```ts
  ...PS_LINEAGE,
  ...KPI_LINEAGE,
];
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts && npm run typecheck`
Expected: PASS nos 9 testes.

- [ ] **Step 6: Commit**

```bash
git add src/server/sinistralidade/queries/kpis-lineage.ts src/server/sinistralidade/lineage.ts tests/unit/sinistralidade-lineage.test.ts
git commit -m "feat(sinistralidade): linhagem dos nove KPIs executivos"
```

---

### Task 5: Rota `scope=lineage`

**Files:**
- Modify: `src/server/sinistralidade/index.ts` (imports no topo; novo bloco dentro de `sinistralidadeV2Handler`, logo após o `if (input.scope === "metadata") { ... }`)
- Test: `tests/unit/sinistralidade-lineage.test.ts`

**Interfaces:**
- Consumes: `lineageRegistry()` (Task 2-4); `rejectMdsAuth` de `lib/basic-auth`; `ApiRequest`/`ApiResponse` já definidos em `index.ts`.
- Produces: resposta `200 { lineage: LineageRegistry }` para papel `full`; `403` para papel `mds`; header `Cache-Control: private, max-age=3600`. Também: campo `role` na resposta de `scope=metadata`, consumido pela Task 9.

**Por que `role` no metadata:** a spec exige que o botão só renderize para papel `full`.
Nenhum componente da aba conhece o papel hoje — `SinistralidadeV2Tab` não recebe props, e
`DashboardTabs` o monta sem nada. Plumbar o papel desde `DashboardShell` atravessaria três
componentes só para isso. A aba já consulta `scope=metadata` na montagem e guarda `features`;
devolver `role` ali resolve com uma linha no servidor e sem cadeia de props nova.

- [ ] **Step 1: Escrever o teste que falha**

Adicione no fim de `tests/unit/sinistralidade-lineage.test.ts`, fora do `describe` existente:

```ts
import { sinistralidadeV2Handler } from "../../src/server/sinistralidade/index";

function fakeRes() {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body: unknown = null;
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      statusCode = code;
      return {
        json(payload: unknown) {
          body = payload;
        },
        end() {
          body = null;
        },
      };
    },
  };
  return { res, headers, get statusCode() { return statusCode; }, get body() { return body; } };
}

function basic(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

describe("rota scope=lineage", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      DASHBOARD_AUTH_USER: "admin",
      DASHBOARD_AUTH_PASSWORD: "senha-admin",
      DASHBOARD_MDS_AUTH_USER: "mds",
      DASHBOARD_MDS_AUTH_PASSWORD: "senha-mds",
    };
  });

  afterEach(() => {
    process.env = env;
  });

  it("entrega o registro para o papel full", async () => {
    const ctx = fakeRes();
    await sinistralidadeV2Handler(
      { method: "GET", query: { scope: "lineage" }, headers: { authorization: basic("admin", "senha-admin") } },
      ctx.res,
    );
    expect(ctx.statusCode).toBe(200);
    expect((ctx.body as { lineage: { entries: unknown[] } }).lineage.entries).toHaveLength(25);
    expect(ctx.headers["Cache-Control"]).toBe("private, max-age=3600");
  });

  it("recusa o papel mds com 403", async () => {
    const ctx = fakeRes();
    await sinistralidadeV2Handler(
      { method: "GET", query: { scope: "lineage" }, headers: { authorization: basic("mds", "senha-mds") } },
      ctx.res,
    );
    expect(ctx.statusCode).toBe(403);
  });
});
```

Acrescente `beforeEach` e `afterEach` ao import de `vitest` no topo do arquivo:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: FAIL — o handler cai no caminho legado e responde 400 por falta de `company_key`, em vez de 200 com o registro.

- [ ] **Step 3: Implementar a rota**

Em `src/server/sinistralidade/index.ts`, adicione ao import existente de `lib/basic-auth` (linha 6) o `rejectMdsAuth`:

```ts
import { getDashboardAuth, rejectMdsAuth, requireBasicAuth } from "../../../lib/basic-auth";
```

E o import do agregador, junto aos demais imports locais:

```ts
import { lineageRegistry } from "./lineage";
```

Dentro de `sinistralidadeV2Handler`, imediatamente **depois** do bloco `if (input.scope === "metadata") { ... }` e **antes** de `if (isLongitudinalScope(input.scope))`, insira:

```ts
    // Linhagem: metadado estático. Não depende de empresa nem de período, não
    // toca o Databricks e por isso é resolvida antes do gate de fechamento.
    if (input.scope === "lineage") {
      if (rejectMdsAuth(req, res)) return;
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.status(200).json({ lineage: lineageRegistry() });
    }
```

- [ ] **Step 4: Expor o papel no `scope=metadata`**

No mesmo arquivo, dentro do bloco `if (input.scope === "metadata")`, adicione `role` ao objeto
da resposta, logo depois de `source`:

```ts
      return res.status(200).json({
        source: legacyMetadata(),
        role: auth.role,
        features: {
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: PASS nos 11 testes.

- [ ] **Step 6: Confirmar que a suíte inteira segue verde**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/sinistralidade/index.ts tests/unit/sinistralidade-lineage.test.ts
git commit -m "feat(sinistralidade): rota scope=lineage com bloqueio do papel mds"
```

---

### Task 6: Hook de busca e contexto do modo no cliente

**Files:**
- Create: `src/features/sinistralidade/hooks/useLineageRegistry.ts`
- Create: `src/features/sinistralidade/components/LineageProvider.tsx`
- Modify: `src/features/sinistralidade/types.ts` (reexporta os tipos de linhagem)

**Interfaces:**
- Consumes: `LineageEntry`, `LineageRegistry` (Task 1); rota `scope=lineage` (Task 5); `scopeUrl` de `hooks/useSinistralidadeScope.ts`.
- Produces:
  - `useLineageRegistry(enabled: boolean): { status: "idle" | "loading" | "ready" | "error"; entries: Map<string, LineageEntry>; retry: () => void }`
  - `<LineageProvider available={boolean}>{children}</LineageProvider>`
  - `useLineage(): { available: boolean; enabled: boolean; toggle: () => void; status: LineageStatus; activeId: string | null; open: (id: string) => void; close: () => void; entry: LineageEntry | null; entries: Map<string, LineageEntry>; retry: () => void }`

- [ ] **Step 1: Reexportar os tipos no módulo de tipos da aba**

Em `src/features/sinistralidade/types.ts`, adicione junto aos demais reexports:

```ts
export type { LineageEntry, LineageRegistry, LineageSource, LineageLayer } from "../../contracts/sinistralidade-v2";
export type { DashboardRole } from "../../contracts/common";
```

- [ ] **Step 2: Escrever o hook de busca**

Create `src/features/sinistralidade/hooks/useLineageRegistry.ts`:

```ts
"use client";

// Busca o registro de linhagem uma única vez, na primeira vez que o modo é
// ligado. É metadado estático: não refaz a requisição quando os filtros mudam.

import { useCallback, useEffect, useState } from "react";
import type { LineageEntry, LineageRegistry } from "../types";

export type LineageStatus = "idle" | "loading" | "ready" | "error";

export type LineageRegistryResult = {
  status: LineageStatus;
  entries: Map<string, LineageEntry>;
  retry: () => void;
};

const EMPTY = new Map<string, LineageEntry>();

export function useLineageRegistry(enabled: boolean): LineageRegistryResult {
  const [status, setStatus] = useState<LineageStatus>("idle");
  const [entries, setEntries] = useState<Map<string, LineageEntry>>(EMPTY);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Já carregado: não refaz. Desligado: não busca.
    if (!enabled || entries.size > 0) return;
    let cancelled = false;
    setStatus("loading");
    fetch("/api/sinistralidade/v2?scope=lineage", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Falha ${response.status}`);
        const body = (await response.json()) as { lineage?: LineageRegistry };
        if (cancelled) return;
        const list = body.lineage?.entries ?? [];
        setEntries(new Map(list.map((entry) => [entry.id, entry])));
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, entries.size, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { status, entries, retry };
}
```

- [ ] **Step 3: Escrever o provider**

Create `src/features/sinistralidade/components/LineageProvider.tsx`:

```tsx
"use client";

// Estado do modo "Análise Databricks": ligado/desligado e qual bloco está
// selecionado. Fica num contexto para que o toggle no cabeçalho, os alvos
// espalhados pela página e a gaveta não precisem se conhecer.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLineageRegistry, type LineageStatus } from "../hooks/useLineageRegistry";
import type { LineageEntry } from "../types";

type LineageContextValue = {
  /** Papel do usuário permite inspecionar linhagem. Falso esconde o recurso inteiro. */
  available: boolean;
  enabled: boolean;
  toggle: () => void;
  status: LineageStatus;
  activeId: string | null;
  open: (id: string) => void;
  close: () => void;
  entry: LineageEntry | null;
  entries: Map<string, LineageEntry>;
  retry: () => void;
};

const LineageContext = createContext<LineageContextValue | null>(null);

export function LineageProvider({ available, children }: { available: boolean; children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  // available falso nunca liga o modo, mesmo que algo chame toggle().
  const active = available && enabled;
  const { status, entries, retry } = useLineageRegistry(active);

  const toggle = useCallback(() => {
    setEnabled((current) => {
      // Desligar o modo fecha a gaveta: alvo selecionado sem modo ativo não faz sentido.
      if (current) setActiveId(null);
      return !current;
    });
  }, []);

  const open = useCallback((id: string) => setActiveId(id), []);
  const close = useCallback(() => setActiveId(null), []);

  const value = useMemo<LineageContextValue>(
    () => ({
      available,
      enabled: active,
      toggle,
      status,
      activeId,
      open,
      close,
      entry: activeId ? (entries.get(activeId) ?? null) : null,
      entries,
      retry,
    }),
    [available, active, toggle, status, activeId, open, close, entries, retry],
  );

  return <LineageContext.Provider value={value}>{children}</LineageContext.Provider>;
}

export function useLineage(): LineageContextValue {
  const value = useContext(LineageContext);
  if (!value) throw new Error("useLineage exige LineageProvider acima na árvore.");
  return value;
}
```

- [ ] **Step 4: Verificar tipos e lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. Não há teste unitário nesta task: o Vitest roda em `environment: "node"` e o projeto não tem jsdom. O comportamento é coberto pelo E2E da Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/features/sinistralidade/hooks/useLineageRegistry.ts src/features/sinistralidade/components/LineageProvider.tsx src/features/sinistralidade/types.ts
git commit -m "feat(sinistralidade): contexto e busca do registro de linhagem no cliente"
```

---

### Task 7: `LineageAnchor` e integração com `ChartCard` e `Kpi`

**Files:**
- Create: `src/features/sinistralidade/components/LineageAnchor.tsx`
- Modify: `src/features/sinistralidade/components/charts.tsx:66-84` (assinatura e corpo de `ChartCard`)
- Modify: `src/features/sinistralidade/components/ExecutiveKpis.tsx` (assinatura e corpo de `Kpi`)
- Modify: `src/features/sinistralidade/SinistralidadeV2Tab.module.css` (classes do alvo)

**Interfaces:**
- Consumes: `useLineage()` (Task 6).
- Produces: `<LineageAnchor lineageId={string | undefined} label={string}>{children}</LineageAnchor>`; `ChartCard` e `Kpi` passam a aceitar a prop opcional `lineageId?: string`.

- [ ] **Step 1: Escrever o componente de âncora**

Create `src/features/sinistralidade/components/LineageAnchor.tsx`:

```tsx
"use client";

// Transforma qualquer bloco num alvo clicável enquanto o modo "Análise
// Databricks" está ligado. Com o modo desligado devolve os filhos sem
// envoltório extra e sem nenhum atributo: o DOM fica idêntico ao original.

import type { KeyboardEvent, ReactNode } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { useLineage } from "./LineageProvider";

export function LineageAnchor({
  lineageId,
  label,
  children,
}: {
  lineageId?: string;
  label: string;
  children: ReactNode;
}) {
  const { enabled, activeId, open } = useLineage();
  if (!enabled || !lineageId) return <>{children}</>;

  const active = activeId === lineageId;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open(lineageId as string);
  }

  return (
    <div
      className={`${styles.lineageAnchor} ${active ? styles.lineageAnchorActive : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`Ver linhagem Databricks de ${label}`}
      onClick={() => open(lineageId)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Adicionar as classes de estilo**

No fim de `src/features/sinistralidade/SinistralidadeV2Tab.module.css`:

```css
/* ---- Modo Análise Databricks (contrato 1.2.0) ---- */
.lineageAnchor {
  position: relative;
  cursor: pointer;
  border-radius: 12px;
  outline: 2px dashed rgba(37, 99, 235, 0.35);
  outline-offset: 4px;
  transition: outline-color 0.15s var(--ease);
}

.lineageAnchor:hover,
.lineageAnchor:focus-visible {
  outline-color: rgba(37, 99, 235, 0.9);
  outline-style: solid;
}

.lineageAnchorActive {
  outline-color: #2563eb;
  outline-style: solid;
}

@media (prefers-reduced-motion: reduce) {
  .lineageAnchor {
    transition: none;
  }
}
```

- [ ] **Step 3: Ligar no `ChartCard`**

Em `src/features/sinistralidade/components/charts.tsx`, importe a âncora no topo:

```tsx
import { LineageAnchor } from "./LineageAnchor";
```

Substitua a assinatura de `ChartCard` (linhas 66-84) para incluir `lineageId`:

```tsx
export function ChartCard({
  title,
  subtitle,
  unit,
  coverageNote,
  chart,
  table,
  legend,
  lineageId,
}: {
  title: string;
  subtitle?: string;
  unit: string;
  /** Mantido por compatibilidade com os chamadores; não é mais exibido na legenda. */
  periodLabel?: string;
  coverageNote?: string | null;
  chart: ReactNode;
  table: ReactNode;
  legend?: ReactNode;
  lineageId?: string;
}) {
```

E envolva o `<figure>` retornado. O `return (` do componente passa a ser:

```tsx
  return (
    <LineageAnchor lineageId={lineageId} label={title}>
      <figure className={styles.chartFigure}>
```

fechando com `</figure>` seguido de `</LineageAnchor>` antes do `);` final do componente.

- [ ] **Step 4: Ligar no `Kpi`**

Em `src/features/sinistralidade/components/ExecutiveKpis.tsx`, importe a âncora:

```tsx
import { LineageAnchor } from "./LineageAnchor";
```

Substitua a função `Kpi` inteira:

```tsx
function Kpi({
  label,
  value,
  helper,
  muted,
  lineageId,
}: {
  label: string;
  value: string;
  helper: string;
  muted?: boolean;
  lineageId?: string;
}) {
  return (
    <LineageAnchor lineageId={lineageId} label={label}>
      <article className={`${styles.kpi} ${muted ? styles.mutedKpi : ""}`}>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{helper}</small>
      </article>
    </LineageAnchor>
  );
}
```

- [ ] **Step 5: Preencher os `lineageId` dos nove KPIs**

Ainda em `ExecutiveKpis.tsx`, adicione a prop a cada um dos nove `<Kpi>`, na ordem em que aparecem:

```tsx
      <Kpi lineageId="kpi.gross_cost" label="Custo assistencial (janela)" value={money.format(kpis.gross_cost)} helper={`${kpis.months_included} mês(es) incluído(s) · R$`} />
      <Kpi lineageId="kpi.utilizers" label="Beneficiários utilizantes" value={number.format(kpis.utilizers)} helper="pessoas distintas na janela" />
      <Kpi lineageId="kpi.service_quantity" label="Serviços realizados" value={number.format(kpis.service_quantity)} helper="quantidade de serviços" />
      <Kpi lineageId="kpi.hospitalization_episodes" label="Episódios de internação" value={number.format(kpis.hospitalization_episodes)} helper="episódios distintos (episode_key)" />
      <Kpi lineageId="kpi.utilizing_families" label="Famílias utilizantes" value={number.format(kpis.utilizing_families)} helper="famílias distintas na janela" />
```

E nas quatro restantes (`Custo por utilizante`, `Serviços por utilizante`, `Custo por vida elegível`, `Internações por mil vidas`), acrescente respectivamente `lineageId="kpi.cost_per_utilizer"`, `lineageId="kpi.services_per_utilizer"`, `lineageId="kpi.cost_per_eligible_life"` e `lineageId="kpi.hospitalizations_per_thousand_lives"` como primeira prop, preservando as demais props exatamente como estão.

- [ ] **Step 6: Verificar tipos, lint e build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS. O build pega erro de JSX desbalanceado no `ChartCard`, que é o risco desta task.

- [ ] **Step 7: Commit**

```bash
git add src/features/sinistralidade/components/LineageAnchor.tsx src/features/sinistralidade/components/charts.tsx src/features/sinistralidade/components/ExecutiveKpis.tsx src/features/sinistralidade/SinistralidadeV2Tab.module.css
git commit -m "feat(sinistralidade): alvos clicáveis de linhagem em gráficos e KPIs"
```

---

### Task 8: Gaveta de linhagem

**Files:**
- Create: `src/features/sinistralidade/components/LineageDrawer.tsx`
- Modify: `src/features/sinistralidade/SinistralidadeV2Tab.module.css` (classes da gaveta)

**Interfaces:**
- Consumes: `useLineage()` (Task 6); classes `.drawer`, `.drawerHeader`, `.drawerBody`, `.drawerList` já existentes no módulo CSS.
- Produces: `<LineageDrawer />` — renderiza `null` quando o modo está desligado ou nada está selecionado.

- [ ] **Step 1: Escrever o componente**

Create `src/features/sinistralidade/components/LineageDrawer.tsx`:

```tsx
"use client";

// Gaveta de linhagem. Diferente do UserDetailDrawer, esta é NÃO-MODAL: sem
// overlay, sem aria-modal e sem prender o foco, porque o usuário precisa
// clicar de um bloco para outro com ela aberta, comparando as origens.

import { useEffect } from "react";
import styles from "../SinistralidadeV2Tab.module.css";
import { useLineage } from "./LineageProvider";

const LAYER_LABEL: Record<string, string> = {
  silver: "Silver",
  gold: "Gold",
  mart: "Mart",
  control: "Controle",
};

export function LineageDrawer() {
  const { enabled, activeId, entry, status, close, open, entries, retry } = useLineage();

  useEffect(() => {
    if (!activeId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, close]);

  if (!enabled || !activeId) return null;

  return (
    <aside className={`${styles.drawer} ${styles.lineageDrawer}`} role="complementary" aria-label="Linhagem Databricks">
      <div className={styles.drawerHeader}>
        <div>
          <h3>{entry?.label ?? "Linhagem"}</h3>
          <p>{entry ? `Camada ${LAYER_LABEL[entry.layer] ?? entry.layer}` : "Origem dos dados no Databricks"}</p>
        </div>
        <button type="button" onClick={close} aria-label="Fechar linhagem">
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      </div>

      <div className={styles.drawerBody} aria-live="polite">
        {status === "error" ? (
          <div className={styles.blockError} role="alert">
            <strong>Não foi possível carregar a linhagem.</strong>
            <span>O restante do dashboard continua funcionando.</span>
            <button type="button" onClick={retry}>Tentar novamente</button>
          </div>
        ) : status === "loading" ? (
          <div className={styles.blockLoading} role="status">Carregando a linhagem…</div>
        ) : !entry ? (
          <div className={styles.blockEmpty}>
            Linhagem não documentada para este bloco ({activeId}).
          </div>
        ) : (
          <>
            <span className={`${styles.lineageLayer} ${styles[`lineageLayer_${entry.layer}`]}`}>
              {LAYER_LABEL[entry.layer] ?? entry.layer}
            </span>

            <h4>Como é calculado</h4>
            <p className={styles.lineageFormula}>{entry.formula}</p>

            <h4>Origem no Databricks</h4>
            <ul className={styles.drawerList}>
              {entry.sources.map((source) => (
                <li key={source.object}>
                  <span><code>{source.object}</code></span>
                  <small>{source.role}</small>
                  <div className={styles.lineageColumns}>
                    {source.columns.map((column) => (
                      <code key={column}>{column}</code>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            <h4>Filtros aplicados</h4>
            <ul className={styles.lineageFilters}>
              {entry.filters.map((filter) => (
                <li key={filter}>{filter}</li>
              ))}
            </ul>

            {entry.notes?.length ? (
              <>
                <h4>Observações</h4>
                <ul className={styles.lineageNotes}>
                  {entry.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            ) : null}

            {entry.related?.length ? (
              <>
                <h4>Relacionados</h4>
                <div className={styles.lineageRelated}>
                  {entry.related.map((id) => (
                    <button type="button" key={id} onClick={() => open(id)}>
                      {entries.get(id)?.label ?? id}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Adicionar as classes de estilo**

No fim de `src/features/sinistralidade/SinistralidadeV2Tab.module.css`, depois do bloco criado na Task 7:

```css
/* Gaveta não-modal: convive com a página, não bloqueia interação. */
.lineageDrawer {
  z-index: 40;
}

.lineageLayer {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 999px;
  margin-bottom: 14px;
}

.lineageLayer_silver { background: #e2e8f0; color: #334155; }
.lineageLayer_gold { background: #fef3c7; color: #92400e; }
.lineageLayer_mart { background: #dbeafe; color: #1e40af; }
.lineageLayer_control { background: #ede9fe; color: #5b21b6; }

.lineageFormula {
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
  margin-bottom: 6px;
}

.lineageColumns {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.lineageColumns code {
  font-size: 11px;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 2px 6px;
  color: #475569;
}

.lineageFilters,
.lineageNotes {
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
  padding-left: 18px;
  margin-bottom: 6px;
}

.lineageFilters li,
.lineageNotes li {
  list-style: disc;
  margin-bottom: 5px;
}

.lineageRelated {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lineageRelated button {
  font-size: 12px;
  border: 1px solid #cbd5e1;
  background: #fff;
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  color: #1e40af;
}

.lineageRelated button:hover,
.lineageRelated button:focus-visible {
  border-color: #2563eb;
  background: #eff6ff;
}
```

- [ ] **Step 3: Verificar tipos, lint e build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/sinistralidade/components/LineageDrawer.tsx src/features/sinistralidade/SinistralidadeV2Tab.module.css
git commit -m "feat(sinistralidade): gaveta não-modal de linhagem Databricks"
```

---

### Task 9: Fiação — toggle no cabeçalho e ids nos 15 blocos

**Files:**
- Modify: `src/features/sinistralidade/components/AnalyticsHeader.tsx`
- Modify: `src/features/sinistralidade/SinistralidadeV2Tab.tsx` (envolver com `LineageProvider`, montar `LineageDrawer`, envolver os três blocos sem `ChartCard`)
- Modify: `src/features/sinistralidade/components/MonthlyEvolutionChart.tsx:55`, `:118`
- Modify: `src/features/sinistralidade/components/EventMixChart.tsx:41`
- Modify: `src/features/sinistralidade/components/ProcedureAnalysis.tsx:82`, `:114`, `:153`
- Modify: `src/features/sinistralidade/components/HospitalizationAnalysis.tsx:36`
- Modify: `src/features/sinistralidade/components/ProviderAnalysis.tsx:76`, `:117`
- Modify: `src/features/sinistralidade/components/ConcentrationAnalysis.tsx:50`
- Modify: `src/features/sinistralidade/components/PsItemAnalysis.tsx:20`
- Modify: `src/features/sinistralidade/components/FamilyCareAnalysis.tsx:19` (ChartCard) e `:63` (bloco `CareTimelineBlock`)
- Modify: `src/features/sinistralidade/components/TopUsersTable.tsx`
- Modify: `src/features/sinistralidade/components/CompanyBenchmark.tsx`
- Modify: `src/features/sinistralidade/SinistralidadeV2Tab.module.css`

**Interfaces:**
- Consumes: `LineageProvider`, `useLineage` (Task 6); `LineageAnchor` (Task 7); `LineageDrawer` (Task 8); prop `lineageId` de `ChartCard` (Task 7).
- Produces: os 15 ids de bloco presentes no DOM quando o modo está ligado.

- [ ] **Step 1: Adicionar o toggle ao cabeçalho**

Em `src/features/sinistralidade/components/AnalyticsHeader.tsx`, importe:

```tsx
import { useLineage } from "./LineageProvider";
```

No corpo do componente, antes do `return`:

```tsx
  const lineage = useLineage();
```

E logo depois do `</div>` que fecha `styles.controls` (o bloco com os quatro seletores), insira:

```tsx
      {lineage.available ? (
      <div className={styles.lineageToggleRow}>
        <button
          type="button"
          className={`${styles.lineageToggle} ${lineage.enabled ? styles.lineageToggleOn : ""}`}
          aria-pressed={lineage.enabled}
          disabled={lineage.status === "loading"}
          onClick={lineage.toggle}
        >
          <i className="fa-solid fa-diagram-project" aria-hidden="true" />
          <span>{lineage.status === "loading" ? "Carregando linhagem…" : "Análise Databricks"}</span>
        </button>
        {lineage.enabled ? (
          <p className={styles.lineageHint} role="status">
            Modo de análise ligado: clique em um gráfico ou indicador para ver de onde o dado vem.
            Clique no botão novamente para sair.
          </p>
        ) : null}
      </div>
      ) : null}
```

- [ ] **Step 2: Estilizar o toggle**

No fim de `src/features/sinistralidade/SinistralidadeV2Tab.module.css`:

```css
.lineageToggleRow {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.lineageToggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #334155;
  border-radius: 999px;
  padding: 7px 14px;
  cursor: pointer;
}

.lineageToggle:disabled {
  opacity: 0.6;
  cursor: progress;
}

.lineageToggleOn {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1e40af;
}

.lineageHint {
  font-size: 12px;
  color: #1e40af;
  margin: 0;
}
```

- [ ] **Step 3: Capturar o papel vindo do metadata**

Em `src/features/sinistralidade/SinistralidadeV2Tab.tsx`, adicione aos imports:

```tsx
import { LineageDrawer } from "./components/LineageDrawer";
import { LineageProvider } from "./components/LineageProvider";
import type { DashboardRole } from "./types";
```

Junto aos outros `useState` de `SinistralidadeV2Tab` (linhas 46-49):

```tsx
  const [role, setRole] = useState<DashboardRole | null>(null);
```

No `useEffect` que consulta `scope=metadata`, a resposta agora traz `role` (Task 5, Step 4).
Logo depois da linha `setFeatures((body.features ?? null) as Features | null);`, acrescente:

```tsx
        setRole((body.role ?? null) as DashboardRole | null);
```

O objeto da resposta chama-se `body` nesse efeito, e é destipado (`response.json()`), então
o cast é necessário.

Passe o papel adiante no `<LongitudinalExperience ... />` (linha 83), adicionando a prop:

```tsx
            role={role}
```

E declare-a na assinatura de `LongitudinalExperience`, junto das props existentes:

```tsx
  role,
```
```tsx
  role: DashboardRole | null;
```

- [ ] **Step 4: Montar o provider e a gaveta**

Ainda em `SinistralidadeV2Tab.tsx`, envolva o conteúdo de `LongitudinalExperience`. O
`return (` desse componente (que hoje abre com `<AnalyticsHeader`) passa a ser:

```tsx
  return (
    <LineageProvider available={role === "full"}>
      <AnalyticsHeader
```

e, antes do `);` que fecha o componente, depois do `<UserDetailDrawer ... />`:

```tsx
      <LineageDrawer />
    </LineageProvider>
  );
```

- [ ] **Step 5: Passar `lineageId` nos doze `ChartCard`**

Adicione a prop `lineageId` como primeira prop de cada `<ChartCard`, mantendo todas as demais props intactas:

| Arquivo | Linha do `<ChartCard` | Valor |
|---|---|---|
| `MonthlyEvolutionChart.tsx` | 55 | `lineageId="timeline.competency"` |
| `MonthlyEvolutionChart.tsx` | 118 | `lineageId="timeline.monthly"` |
| `EventMixChart.tsx` | 41 | `lineageId="event-mix.cost"` |
| `ProcedureAnalysis.tsx` | 82 | `lineageId="procedure-trends.pareto"` |
| `ProcedureAnalysis.tsx` | 114 | `lineageId="procedure-trends.scatter"` |
| `ProcedureAnalysis.tsx` | 153 | `lineageId="procedure-trends.monthly"` |
| `HospitalizationAnalysis.tsx` | 36 | `lineageId="hospitalization-trends.monthly"` |
| `ProviderAnalysis.tsx` | 76 | `lineageId="provider-trends.monthly"` |
| `ProviderAnalysis.tsx` | 117 | `lineageId="provider-trends.network"` |
| `ConcentrationAnalysis.tsx` | 50 | `lineageId="concentration.monthly"` |
| `PsItemAnalysis.tsx` | 20 | `lineageId="ps-trends.monthly"` |
| `FamilyCareAnalysis.tsx` | 19 | `lineageId="family-timeline.relative"` |

Exemplo, em `EventMixChart.tsx`:

```tsx
      <ChartCard
        lineageId="event-mix.cost"
        title="Custo por evento"
```

**Atenção:** os números de linha são de antes desta task. Depois de editar um arquivo com dois `ChartCard`, o segundo desce. Localize pelo valor de `title=` em vez de pela linha.

- [ ] **Step 6: Envolver os três blocos que não são `ChartCard`**

Nos três arquivos, importe a âncora:

```tsx
import { LineageAnchor } from "./LineageAnchor";
```

**`TopUsersTable.tsx`** — o `return` do componente hoje abre com `<div className={styles.cardHeaderRow}>` dentro de um elemento raiz. Envolva o elemento raiz inteiro:

```tsx
    <LineageAnchor lineageId="top-users-window.table" label="Maiores utilizantes da janela">
      {/* raiz original, do primeiro elemento até seu fechamento, sem alterar nada dentro */}
    </LineageAnchor>
```

**`CompanyBenchmark.tsx`** — o `return` abre com `<article className={styles.card}>` (linha 13). Fica:

```tsx
  return (
    <LineageAnchor lineageId="company-benchmark.table" label="Comparação entre empresas">
      <article className={styles.card}>
        {/* conteúdo original */}
      </article>
    </LineageAnchor>
  );
```

**`FamilyCareAnalysis.tsx`, função `CareTimelineBlock`** — o `return` abre com `<article className={styles.card}>` (linha 69). Fica:

```tsx
  return (
    <LineageAnchor lineageId="care-timeline.matrix" label="Fatura × coordenação por mês">
      <article className={styles.card}>
        {/* conteúdo original */}
      </article>
    </LineageAnchor>
  );
```

Não altere `FamilyTimelineBlock` no mesmo arquivo: ele já é coberto pelo `ChartCard` com `lineageId="family-timeline.relative"` do Step 5.

- [ ] **Step 7: Verificar tipos, lint e build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 8: Conferir manualmente no navegador**

Run: `npm run dev`

Abra `http://localhost:3000`, entre com as credenciais de `DASHBOARD_AUTH_USER`, vá em Sinistralidade → Visão 360 e confirme:
- O botão "Análise Databricks" aparece no cabeçalho.
- Ligado, os cards ganham contorno tracejado e a faixa de aviso aparece.
- Clicar num card abre a gaveta com nome de tabela e colunas.
- Clicar num segundo card troca o conteúdo sem fechar.
- `Escape` fecha; desligar o modo remove os contornos.
- Um bloco em estado "Período bloqueado pelo gate de fechamento" ainda abre a gaveta — este é o cenário que mais justifica o recurso.

- [ ] **Step 9: Commit**

```bash
git add src/features/sinistralidade/
git commit -m "feat(sinistralidade): liga o modo Análise Databricks nos quinze blocos da Visão 360"
```

---

### Task 10: Teste E2E do modo de análise

**Files:**
- Modify: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1-9.
- Produces: nenhum artefato consumido por outra task. Esta é a última.

- [ ] **Step 1: Escrever o teste**

Adicione ao fim de `tests/e2e/dashboard.spec.ts`, seguindo o padrão de login já usado no arquivo:

```ts
test("modo Análise Databricks revela a linhagem de um bloco", async ({ page }) => {
  await page.goto("/");
  await page.fill("#auth-user", process.env.DASHBOARD_AUTH_USER as string);
  await page.fill("#auth-password", process.env.DASHBOARD_AUTH_PASSWORD as string);
  await page.click(".auth-submit");

  await page.click('[data-tab="sinistralidade-v2"]');

  const toggle = page.getByRole("button", { name: "Análise Databricks" });
  await expect(toggle).toBeVisible();

  // Desligado: nenhum alvo de linhagem no DOM.
  await expect(page.getByRole("button", { name: /Ver linhagem Databricks de/ })).toHaveCount(0);

  await toggle.click();

  const alvo = page.getByRole("button", { name: "Ver linhagem Databricks de Custo assistencial (janela)" });
  await expect(alvo).toBeVisible();
  await alvo.click();

  const gaveta = page.getByRole("complementary", { name: "Linhagem Databricks" });
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("mart_sinistro_empresa_mes_v2");
  await expect(gaveta).toContainText("custo_assistencial_bruto");

  // Trocar de alvo mantém a gaveta aberta e troca o conteúdo.
  await page.getByRole("button", { name: "Ver linhagem Databricks de Episódios de internação" }).click();
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("mart_internacao_mes_v2");

  await page.keyboard.press("Escape");
  await expect(gaveta).toBeHidden();
});
```

- [ ] **Step 2: Rodar o E2E**

Run: `npm run test:e2e -- --grep "Análise Databricks"`
Expected: PASS. Se falhar por tempo de carregamento dos KPIs, envolva a primeira asserção de alvo com `await expect(alvo).toBeVisible({ timeout: 30000 })` — as consultas ao Databricks levam segundos.

- [ ] **Step 3: Rodar a validação completa**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`
Expected: PASS em tudo. Um E2E pré-existente da aba "Petit Comitê MDS" já falha antes desta mudança (registrado como dívida técnica em `docs/sinistralidade/IMPLEMENTACAO.md`); confirme que a falha é a mesma de antes e não uma regressão nova.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/dashboard.spec.ts
git commit -m "test(sinistralidade): E2E do modo Análise Databricks"
```

---

## Verificação final contra os critérios de aceite da spec

| Critério | Onde é verificado |
|---|---|
| Usuário `full` clica em qualquer um dos 24 alvos e vê camada, fórmula, fontes e filtros | Tasks 7-9; E2E na Task 10 |
| Botão só renderiza para papel `full` | Task 5 Step 4 (`role` no metadata) + Task 6 (`available` no provider) + Task 9 Steps 1 e 3 |
| `scope=lineage` com credencial `mds` responde 403 | Teste unitário na Task 5 |
| Bloco com período bloqueado (`409`) ainda abre linhagem | A gaveta lê o registro, nunca a resposta do escopo — garantido pela arquitetura da Task 6; confirmação manual na Task 9, Step 7 |
| Com o modo desligado, o DOM dos cards é idêntico ao de hoje | `LineageAnchor` retorna `<>{children}</>` (Task 7); asserção de `toHaveCount(0)` na Task 10 |
| `lint`, `typecheck`, `test`, `test:e2e` passam | Task 10, Step 3 |
| Nenhuma consulta ao Databricks pelo escopo `lineage` | Task 5: o bloco retorna antes de `createQueryRunner`; o teste unitário roda sem credencial de Databricks e passa |
