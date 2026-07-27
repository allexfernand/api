# Consolidação da Análise Sinistro sobre a Gold — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aba Análise Sinistro passa a ser o conteúdo do Preview Gold, reescrito em React sobre a Gold, com série por competência e modo de linhagem; a seção Sinistralidade fica com duas abas.

**Architecture:** O servidor mantém as 17 consultas atuais do `/api/gold-preview` e ganha duas coisas: a série por competência de cobrança e o papel do usuário no bloco `fonte`. O cliente troca 75KB de JavaScript legado por componentes React que consomem o mesmo payload único, usando os primitivos de gráfico já revisados da Visão 360. A navegação perde a aba Preview Gold e o legado é removido.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5.9, Zod 4, Vitest 4 (ambiente `node`), Playwright 1.61.

**Spec:** `docs/superpowers/specs/2026-07-26-consolidacao-analise-sinistro-design.md`

## Global Constraints

- Diretório de trabalho: `/Users/marcoruas/Documents/SANUS/api`. Caminhos relativos a ele.
- **Nenhuma das 17 consultas existentes em `src/server/routes/gold-preview.ts` pode mudar.** Os números que a aba mostra hoje são os que deve mostrar depois. A única consulta nova é a de competência.
- Português do Brasil em todo texto de interface e comentário de código.
- **Nenhum número cravado nos componentes.** O fragmento legado tem 26 valores de fallback; nenhum deles sobrevive. Falha vira estado de falha.
- Componentes de cliente levam `"use client"` no topo, como os vizinhos.
- Gráficos usam os primitivos de `src/features/sinistralidade/components/charts.tsx` (`ChartCard`, `LineChart`, `StackedBarChart`, `ParetoChart`, `ScatterChart`). Chart.js não entra nesta aba.
- Estados usam `src/features/sinistralidade/components/BlockState.tsx`.
- Vitest roda `environment: "node"`, sem jsdom e sem React Testing Library. **Não adicione framework de teste de componente.** Comportamento de cliente é coberto pelo E2E.
- `npm run lint` reporta exatamente dois erros pré-existentes em `src/features/dashboard/components/DashboardShell.tsx`. Confirme que continuam sendo os únicos.
- **Não commite `next-env.d.ts`** — `npm run build` alterna o arquivo entre as variantes dev e prod.
- Commits em português, Conventional Commits (o repo usa commitlint).
- O perfil `mds` já recebe 403 do `/api/gold-preview` e não alcança a seção na navegação. Não adicione gate novo.

### O fragmento legado é a fonte da verdade do conteúdo

Para os blocos que são transcrição de marcação existente, `src/dashboard/fragments/gold-preview.html` define quais rótulos, colunas e textos devem aparecer, e `public/scripts/gold-preview.js` define como cada campo do payload vira texto na tela. Leia os dois antes de escrever um componente. **O que não deve ser transcrito:** os 26 valores numéricos de fallback e o selo `PREVIEW / MOCK`.

---

### Task 1: Contrato do payload e série por competência

**Files:**
- Create: `src/contracts/gold-preview.ts`
- Modify: `src/server/routes/gold-preview.ts`
- Test: `tests/unit/gold-preview-contract.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `goldPreviewSchema` e o tipo `GoldPreview` de `src/contracts/gold-preview.ts`; o campo `competencia` e o campo `fonte.role` no payload de `/api/gold-preview`.

- [ ] **Step 1: Escrever o teste que falha**

Create `tests/unit/gold-preview-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { goldPreviewSchema } from "../../src/contracts/gold-preview";

const minimo = {
  filtros: { aplicados: {}, disponiveis: {} },
  fonte: {
    gold: "gold_sinistro_evento_v2",
    contract_version: "1.2.0",
    delta_version: 44,
    delta_timestamp: "2026-07-07T00:00:00Z",
    gerado_em: "2026-07-26T00:00:00.000Z",
    filtro: "NOT flag_data_suspeita",
    role: "full",
  },
  mensal: [{ mes: "2026-01", utilizantes: 10, itens: 20, sinistro: 1000, parcial: false }],
  competencia: [{ mes: "2026-01", sinistro: 900, servicos: 18, linhas: 20 }],
  composicao_tipo_evento: [],
  kpis: {
    ultimo_mes_fechado: "2026-01",
    sinistro_ultimo_mes_fechado: 1000,
    utilizantes_ultimo_mes_fechado: 10,
    janela_12m: ["2026-01"],
    sinistro_12m: 1000,
    utilizantes_12m: 10,
    custo_por_utilizante_12m: 100,
    reembolso_share_12m: 3.3,
  },
  lotacoes: [],
  prestadores: { total_prestadores: 0, sinistro_total: 0, top: [] },
  concentracao: { janela: ["2026-01"], utilizantes: 10, top1_pessoas: 1, top1_share: 30, top5_share: 50 },
  internacao: { por_agrupamento: [], internacoes_distintas: 0, custo_medio: 0, duracao_mediana_dias: 0, duracao_p90_dias: 0 },
  saude_mental: { share_flag: null, share_sem_classificacao: null, por_tema_mi: [] },
  impacto_sanus: { metodologia: "x", pre: null, pos: null, trimestres_utilizantes: [] },
  comparacao_madura: { metodologia: "x", before_meses: [], after_meses: [], familias_comuns: 0 },
  jornada_sanus: { janela: [], metodologia: "x", servicos: [], proximidade: {} },
  top_utilizantes: { janela: [], aviso: "x", lista: [] },
  carteira: { operadoras: [], empresas: [], beneficiarios_total: 0 },
};

describe("contrato do payload gold-preview", () => {
  it("aceita um payload completo", () => {
    expect(goldPreviewSchema.parse(minimo).competencia).toHaveLength(1);
  });

  it("exige a série de competência", () => {
    const { competencia, ...sem } = minimo;
    expect(goldPreviewSchema.safeParse(sem).success).toBe(false);
  });

  it("exige o papel no bloco fonte", () => {
    const semRole = { ...minimo, fonte: { ...minimo.fonte, role: undefined } };
    expect(goldPreviewSchema.safeParse(semRole).success).toBe(false);
  });

  it("rejeita papel desconhecido", () => {
    const outro = { ...minimo, fonte: { ...minimo.fonte, role: "root" } };
    expect(goldPreviewSchema.safeParse(outro).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run tests/unit/gold-preview-contract.test.ts`
Expected: FAIL — `Cannot find module '../../src/contracts/gold-preview'`.

- [ ] **Step 3: Escrever o contrato**

Create `src/contracts/gold-preview.ts`. Modele cada bloco a partir do que o handler realmente devolve (leia o `res.status(200).json({...})` no fim de `src/server/routes/gold-preview.ts`). Use `.passthrough()` nos objetos cujo formato interno não interessa ao cliente tipado — `filtros.disponiveis`, `jornada_sanus.proximidade` — para não travar o contrato em detalhe que muda.

```ts
import { z } from "zod";
import { dashboardRoleSchema } from "./common";

const serieMensal = z.object({
  mes: z.string(),
  utilizantes: z.number(),
  itens: z.number(),
  sinistro: z.number(),
  parcial: z.boolean(),
});

const serieCompetencia = z.object({
  mes: z.string(),
  sinistro: z.number(),
  servicos: z.number(),
  linhas: z.number(),
});

export const goldPreviewSchema = z.object({
  filtros: z.object({ aplicados: z.record(z.string(), z.array(z.string())), disponiveis: z.object({}).passthrough() }),
  fonte: z.object({
    gold: z.string(),
    contract_version: z.string(),
    delta_version: z.number(),
    delta_timestamp: z.unknown(),
    gerado_em: z.string(),
    filtro: z.string(),
    role: dashboardRoleSchema,
  }),
  mensal: z.array(serieMensal),
  competencia: z.array(serieCompetencia),
  composicao_tipo_evento: z.array(z.object({}).passthrough()),
  kpis: z.object({
    ultimo_mes_fechado: z.string().nullable(),
    sinistro_ultimo_mes_fechado: z.number().nullable(),
    utilizantes_ultimo_mes_fechado: z.number().nullable(),
    janela_12m: z.array(z.string()),
    sinistro_12m: z.number(),
    utilizantes_12m: z.number(),
    custo_por_utilizante_12m: z.number().nullable(),
    reembolso_share_12m: z.number().nullable(),
  }),
  lotacoes: z.array(z.object({ lotacao: z.string(), sinistro: z.number(), beneficiarios: z.number(), share: z.number().nullable() })),
  prestadores: z.object({
    total_prestadores: z.number(),
    sinistro_total: z.number(),
    top: z.array(z.object({ prestador: z.string(), sinistro: z.number(), share: z.number().nullable() })),
  }),
  concentracao: z.object({
    janela: z.array(z.string()),
    utilizantes: z.number(),
    top1_pessoas: z.number(),
    top1_share: z.number().nullable(),
    top5_share: z.number().nullable(),
  }),
  internacao: z.object({
    por_agrupamento: z.array(z.object({ agrupamento: z.string(), sinistro_mi: z.number() })),
    internacoes_distintas: z.number(),
    custo_medio: z.number(),
    duracao_mediana_dias: z.number(),
    duracao_p90_dias: z.number(),
  }),
  saude_mental: z.object({
    share_flag: z.number().nullable(),
    share_sem_classificacao: z.number().nullable(),
    por_tema_mi: z.array(z.object({ tema: z.string(), sinistro_mi: z.number() })),
  }),
  impacto_sanus: z.object({}).passthrough(),
  comparacao_madura: z.object({}).passthrough(),
  jornada_sanus: z.object({}).passthrough(),
  top_utilizantes: z.object({
    janela: z.array(z.string()),
    aviso: z.string(),
    lista: z.array(z.object({}).passthrough()),
  }),
  carteira: z.object({
    operadoras: z.array(z.string()),
    empresas: z.array(z.object({ nome: z.string(), sinistro: z.number(), share: z.number().nullable(), beneficiarios: z.number() })),
    beneficiarios_total: z.number(),
  }),
});

export type GoldPreview = z.infer<typeof goldPreviewSchema>;
```

Se `dashboardRoleSchema` não existir em `src/contracts/common.ts`, use `z.enum(["full", "mds"])` e diga isso no relatório.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run tests/unit/gold-preview-contract.test.ts`
Expected: PASS nos 4 testes.

- [ ] **Step 5: Acrescentar a consulta de competência**

Em `src/server/routes/gold-preview.ts`, dentro do `Promise.all` da Fase 2 (o array que hoje desestrutura `[kpiRows, total24Rows, lotacaoRows, ...]`), acrescente ao FIM do array — e o nome correspondente ao FIM da desestruturação, para não deslocar índices existentes:

```ts
      // Série por COMPETÊNCIA DE COBRANÇA: "quanto foi faturado no mês",
      // contra o "quanto foi atendido no mês" da série `mensal`. Mesmo
      // recorte de filtros; o eixo é que muda.
      q(`SELECT date_format(to_date(g.competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') AS competencia,
           round(sum(g.custo_assistencial_bruto), 2) AS sinistro,
           sum(g.quantidade_servicos) AS servicos,
           count(*) AS linhas
         FROM ${GOLD} g
         WHERE NOT g.flag_data_suspeita
           AND date_format(to_date(g.competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') >= ${SERIE_INICIO}${filtroSql}
         GROUP BY 1 ORDER BY 1`),
```

- [ ] **Step 6: Serializar competência e o papel**

Ainda no mesmo arquivo, monte a série logo antes do `res.status(200).json({...})`:

```ts
    const competencia = competenciaRows
      .map((r) => ({
        mes: String(getCell(r[0])),
        sinistro: toNum(r[1]),
        servicos: toNum(r[2]),
        linhas: toInt(r[3]),
      }))
      .filter((c) => mesValido(c.mes))
      .sort((a, b) => a.mes.localeCompare(b.mes));
```

No objeto da resposta, acrescente `competencia,` logo depois de `mensal:` e `role: auth.role,` dentro do bloco `fonte`. O handler já resolve `auth` — confirme o nome da variável antes de usar.

- [ ] **Step 7: Verificar tudo**

Run: `npm test && npm run typecheck && npm run lint`
Expected: PASS; lint só com os dois erros pré-existentes.

- [ ] **Step 8: Commit**

```bash
git add src/contracts/gold-preview.ts src/server/routes/gold-preview.ts tests/unit/gold-preview-contract.test.ts
git commit -m "feat(sinistro): contrato do payload gold-preview e série por competência"
```

---

### Task 2: Linhagem dos blocos da nova aba

**Files:**
- Create: `src/server/sinistralidade/queries/gold-preview-lineage.ts`
- Modify: `src/server/sinistralidade/lineage.ts`
- Modify: `tests/unit/sinistralidade-lineage.test.ts` (mapa `ENTRY_SOURCE_FILES`)

**Interfaces:**
- Consumes: `LineageEntry` de `src/contracts/sinistralidade-v2.ts`; `TABLES` de `src/server/sinistralidade/query-runner.ts`.
- Produces: `GOLD_PREVIEW_LINEAGE: LineageEntry[]`, com estes ids: `claims.kpis`, `claims.monthly`, `claims.competency`, `claims.quarterly`, `claims.event-mix`, `claims.locations`, `claims.concentration`, `claims.providers`, `claims.hospitalization`, `claims.mental-health`, `claims.sanus-impact`, `claims.mature-comparison`, `claims.sanus-journey`, `claims.top-users`.

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/unit/sinistralidade-lineage.test.ts`, acrescente ao `describe("registro de linhagem", ...)`:

```ts
  it("cobre os blocos da aba Análise Sinistro", () => {
    const ids = registro.entries.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claims.kpis",
        "claims.monthly",
        "claims.competency",
        "claims.quarterly",
        "claims.event-mix",
        "claims.locations",
        "claims.concentration",
        "claims.providers",
        "claims.hospitalization",
        "claims.mental-health",
        "claims.sanus-impact",
        "claims.mature-comparison",
        "claims.sanus-journey",
        "claims.top-users",
      ]),
    );
  });
```

Ajuste também a asserção existente que fixa o total em 25 entradas para o novo total (25 + 14 = 39).

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts`
Expected: FAIL — nenhum id `claims.*` no registro, e o total continua 25.

- [ ] **Step 3: Escrever as entradas**

Create `src/server/sinistralidade/queries/gold-preview-lineage.ts`.

**Antes de escrever, leia `src/server/routes/gold-preview.ts` inteiro** e derive as colunas de cada entrada a partir do SQL que produz aquele bloco. Não copie de outra entrada de linhagem por semelhança de nome: as consultas desta rota são diferentes das dos marts.

Cabeçalho obrigatório do arquivo, registrando a ressalva de co-locação:

```ts
// Linhagem dos blocos da aba Análise Sinistro (/api/gold-preview).
//
// ATENÇÃO — co-locação mais fraca que nas demais entradas do registro. O SQL
// que estas entradas descrevem mora em src/server/routes/gold-preview.ts, não
// neste arquivo. Foi decisão consciente: aquele arquivo já tem ~600 linhas e
// as entradas somariam ~300. Quem alterar uma consulta lá precisa revisar a
// entrada correspondente aqui — o teste de coluna fabricada em
// tests/unit/sinistralidade-lineage.test.ts aponta estas entradas para o
// arquivo da rota e pega nome de coluna inexistente, mas não pega uma coluna
// que existe e deixou de ser usada.
```

A rota consulta seis tabelas, declaradas como constantes locais nas linhas 23-28 de `src/server/routes/gold-preview.ts`. Três já têm chave em `TABLES`, três não:

| Constante na rota | Tabela | Chave em `TABLES` |
|---|---|---|
| `GOLD` | `gold_sinistro_evento_v2` | `TABLES.gold` — existe |
| `MART_EVENTO` | `mart_evento_empresa_mes_v2` | `TABLES.martEventoMes` — existe |
| `MART_PRESTADOR` | `mart_prestador_mes_v2` | `TABLES.martPrestadorMes` — existe |
| `COORDENACAO` | `fact_coordenacao_evento_gold_v2` | **não existe — criar `factCoordenacao`** |
| `SNAPSHOT` | `beneficiary_eligibility_snapshot_v2` | **não existe — criar `eligibilitySnapshot`** |
| `SILVER_FINAL` | `utilizacao_silver_final` | não existe, e **não deve ser criada** |

Acrescente a `TABLES` em `src/server/sinistralidade/query-runner.ts` **apenas** `factCoordenacao` e `eligibilitySnapshot`, e referencie-as pelas chaves nas entradas de linhagem. Cravar a string faz o teste de `TABLES` falhar, e é ele que impede nome de tabela digitado errado.

**Cuidado com uma armadilha de nome:** `TABLES.martCare` já existe e aponta para `mart_fatura_coordenacao_v2`, que **não** é a mesma coisa que `COORDENACAO` (`fact_coordenacao_evento_gold_v2`). Não reaproveite `martCare` por semelhança de nome.

**Por que `silverFinal` fica de fora:** `SILVER_FINAL` é usada só num `DESCRIBE HISTORY` que obtém a versão Delta exibida no cabeçalho. Não alimenta nenhum bloco de número, então nenhuma das 14 entradas a declara como fonte — e uma chave em `TABLES` que nada consome é peso morto. A constante local da rota continua como está.

Cada entrada segue o formato já usado nas 25 existentes: `id`, `kind: "block"`, `label`, `layer`, `sources` (com `object`, `role`, `columns`), `formula` em linguagem de negócio com notação de agregado permitida, `filters`, `notes` e `related` opcionais.

Duas entradas merecem nota específica, porque a diferença entre elas é a razão de existirem as duas:

- `claims.monthly` — eixo `month_key`, data do atendimento. Nota: "Responde quanto foi ATENDIDO no mês."
- `claims.competency` — eixo `competencia_cobranca` convertida de `dd/MM/yyyy`. Nota: "Responde quanto foi FATURADO no mês; difere da série por atendimento pelo lag de cobrança."

E `claims.quarterly` não tem consulta própria: declare como fonte a mesma da série mensal e registre em `notes` que a agregação trimestral é calculada no cliente a partir de `mensal`.

- [ ] **Step 4: Ligar no agregador**

Em `src/server/sinistralidade/lineage.ts`, acrescente o import e o spread no fim do array `ENTRIES`:

```ts
import { GOLD_PREVIEW_LINEAGE } from "./queries/gold-preview-lineage";
```

```ts
  ...KPI_LINEAGE,
  ...GOLD_PREVIEW_LINEAGE,
];
```

- [ ] **Step 5: Mapear no teste de coluna**

Em `tests/unit/sinistralidade-lineage.test.ts`, no mapa `ENTRY_SOURCE_FILES`, acrescente as 14 entradas apontando para os dois arquivos relevantes:

```ts
const ROUTE_GOLD_PREVIEW = "../../src/server/routes/gold-preview.ts";
```

e uma linha por id, no formato `"claims.monthly": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],`.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/sinistralidade-lineage.test.ts && npm run typecheck`
Expected: PASS. Se o teste de coluna acusar, a coluna declarada não aparece no SQL da rota — corrija a entrada, não o teste.

- [ ] **Step 7: Commit**

```bash
git add src/server/sinistralidade/ tests/unit/sinistralidade-lineage.test.ts
git commit -m "feat(sinistro): linhagem dos blocos da aba Análise Sinistro"
```

---

### Task 3: Hooks de dados e filtros

**Files:**
- Create: `src/features/claims/hooks/useGoldPreview.ts`
- Create: `src/features/claims/hooks/useGoldPreviewFilters.ts`
- Create: `src/features/claims/quarterly.ts`
- Test: `tests/unit/claims-quarterly.test.ts`

**Interfaces:**
- Consumes: `goldPreviewSchema`, `GoldPreview` (Task 1).
- Produces:
  - `useGoldPreview(query: string): { status: "loading" | "ready" | "forbidden" | "error"; data: GoldPreview | null; error: string | null; retry: () => void }`
  - `useGoldPreviewFilters(): { selecionados: FacetSelection; aplicados: FacetSelection; alternar(campo, valor): void; limpar(): void; aplicar(): void; querystring: string; sujo: boolean }` com `type FacetSelection = Record<FacetField, string[]>` e `type FacetField = "faixa_etaria" | "sexo" | "tipo_plano" | "cidade" | "estado" | "servico_sanus"`
  - `agruparTrimestres(mensal: GoldPreview["mensal"]): Trimestre[]` de `quarterly.ts`

- [ ] **Step 1: Escrever o teste da agregação trimestral**

Create `tests/unit/claims-quarterly.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agruparTrimestres } from "../../src/features/claims/quarterly";

const mes = (mes: string, sinistro: number, itens: number, utilizantes: number) => ({
  mes, sinistro, itens, utilizantes, parcial: false,
});

describe("agregação trimestral", () => {
  it("agrupa três meses no trimestre correto", () => {
    const r = agruparTrimestres([mes("2026-01", 100, 10, 5), mes("2026-02", 200, 20, 6), mes("2026-03", 300, 30, 7)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ trimestre: "2026-T1", sinistro: 600, itens: 60, meses: 3 });
  });

  it("separa trimestres diferentes e ordena", () => {
    const r = agruparTrimestres([mes("2026-04", 50, 5, 2), mes("2026-01", 100, 10, 5)]);
    expect(r.map((t) => t.trimestre)).toEqual(["2026-T1", "2026-T2"]);
  });

  it("não cria trimestre sem dado", () => {
    const r = agruparTrimestres([mes("2026-01", 100, 10, 5), mes("2026-07", 70, 7, 3)]);
    expect(r.map((t) => t.trimestre)).toEqual(["2026-T1", "2026-T3"]);
  });

  it("marca o trimestre como parcial quando falta mês ou algum mês é parcial", () => {
    const incompleto = agruparTrimestres([mes("2026-01", 100, 10, 5)]);
    expect(incompleto[0].parcial).toBe(true);
    const comParcial = agruparTrimestres([
      mes("2026-01", 100, 10, 5), mes("2026-02", 100, 10, 5), { ...mes("2026-03", 100, 10, 5), parcial: true },
    ]);
    expect(comParcial[0].parcial).toBe(true);
  });

  it("NÃO soma utilizantes entre meses", () => {
    // A mesma pessoa em dois meses contaria duas vezes. O trimestre expõe a
    // média mensal, e o campo deixa isso explícito no nome.
    const r = agruparTrimestres([mes("2026-01", 0, 0, 10), mes("2026-02", 0, 0, 20), mes("2026-03", 0, 0, 30)]);
    expect(r[0].utilizantes_media_mensal).toBe(20);
    expect(r[0]).not.toHaveProperty("utilizantes");
  });

  it("ignora mês com formato inválido", () => {
    expect(agruparTrimestres([mes("2026-13", 1, 1, 1), mes("lixo", 1, 1, 1)])).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run tests/unit/claims-quarterly.test.ts`
Expected: FAIL — módulo `quarterly` não existe.

- [ ] **Step 3: Implementar a agregação**

Create `src/features/claims/quarterly.ts`:

```ts
// Agregação trimestral derivada da série mensal. Não há consulta própria: a
// série `mensal` do payload já traz os três valores por mês.

import type { GoldPreview } from "../../contracts/gold-preview";

export type Trimestre = {
  trimestre: string;
  sinistro: number;
  itens: number;
  /** Média dos utilizantes mensais. Somar contaria a mesma pessoa em cada mês. */
  utilizantes_media_mensal: number;
  meses: number;
  parcial: boolean;
};

export function agruparTrimestres(mensal: GoldPreview["mensal"]): Trimestre[] {
  const buckets = new Map<string, { sinistro: number; itens: number; utilizantes: number[]; parcial: boolean }>();

  for (const linha of mensal) {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(linha.mes);
    if (!match) continue;
    const chave = `${match[1]}-T${Math.ceil(Number(match[2]) / 3)}`;
    const atual = buckets.get(chave) ?? { sinistro: 0, itens: 0, utilizantes: [], parcial: false };
    atual.sinistro += linha.sinistro;
    atual.itens += linha.itens;
    atual.utilizantes.push(linha.utilizantes);
    atual.parcial = atual.parcial || linha.parcial;
    buckets.set(chave, atual);
  }

  return [...buckets.entries()]
    .map(([trimestre, v]) => ({
      trimestre,
      sinistro: Math.round(v.sinistro * 100) / 100,
      itens: v.itens,
      utilizantes_media_mensal: Math.round(v.utilizantes.reduce((s, n) => s + n, 0) / v.utilizantes.length),
      meses: v.utilizantes.length,
      // Trimestre sem os três meses, ou com algum mês parcial, não é comparável.
      parcial: v.parcial || v.utilizantes.length < 3,
    }))
    .sort((a, b) => a.trimestre.localeCompare(b.trimestre));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run tests/unit/claims-quarterly.test.ts`
Expected: PASS nos 6 testes.

- [ ] **Step 5: Escrever o hook de busca**

Create `src/features/claims/hooks/useGoldPreview.ts`.

Siga o padrão de `src/features/sinistralidade/hooks/useSinistralidadeScope.ts` — leia-o antes. Pontos obrigatórios, todos já aprendidos à força neste projeto:

- **Não chame `setState` dentro do efeito.** O lint `react-hooks/set-state-in-effect` proíbe. Derive `status` do estado carregado, como o `useSinistralidadeScope` faz.
- Cancele via flag `cancelled` no cleanup.
- 403 vira `status: "forbidden"`, não `"error"` — o perfil MDS cai aqui.
- Valide a resposta com `goldPreviewSchema.safeParse`. Se falhar, `status: "error"` com mensagem dizendo que o formato mudou: um payload que não bate com o contrato é bug de servidor, não tela vazia.
- `retry()` incrementa uma tentativa que está nas dependências do efeito.

- [ ] **Step 6: Escrever o hook de filtros**

Create `src/features/claims/hooks/useGoldPreviewFilters.ts`.

Espelhe `src/features/sinistralidade/hooks/useSinistralidadeFilters.ts` para a sincronia com a URL, usando prefixo `pg_` (`pg_faixa_etaria`, `pg_sexo`, `pg_tipo_plano`, `pg_cidade`, `pg_estado`, `pg_servico_sanus`), valores separados por vírgula.

O comportamento que diferencia este hook: há **seleção pendente** e **seleção aplicada**. `alternar` mexe na pendente; `aplicar` copia a pendente para a aplicada e é só isso que muda a `querystring` e a URL. `sujo` indica que as duas divergem, para o botão "Aplicar recorte" saber quando está ativo. Isso preserva o comportamento atual da aba, onde nada recarrega até o usuário confirmar.

- [ ] **Step 7: Verificar**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: PASS; lint só com os dois pré-existentes.

- [ ] **Step 8: Commit**

```bash
git add src/features/claims/ tests/unit/claims-quarterly.test.ts
git commit -m "feat(sinistro): hooks de payload, filtros e agregação trimestral"
```

---

### Task 4: Cabeçalho e painel de facetas

**Files:**
- Create: `src/features/claims/components/ClaimsHeader.tsx`
- Create: `src/features/claims/components/FacetPanel.tsx`
- Create: `src/features/claims/ClaimsTab.module.css`

**Interfaces:**
- Consumes: `GoldPreview` (Task 1); `useGoldPreviewFilters` (Task 3); `useLineage` de `src/features/sinistralidade/components/LineageProvider.tsx`.
- Produces: `<ClaimsHeader fonte carteira />` e `<FacetPanel disponiveis filtros />`.

**Referência de conteúdo:** `src/dashboard/fragments/gold-preview.html`, linhas 1-50 (hero e painel de filtros) e `public/scripts/gold-preview.js`, funções `renderControlesFiltro`, `renderOpcoes`, `renderResumoFiltros`, `populateFiltros`.

- [ ] **Step 1: Escrever o cabeçalho**

`ClaimsHeader` mostra: identidade da aba, a carteira (operadoras, número de empresas e de beneficiários, vindos de `carteira`), a data de geração e a versão Delta (de `fonte`), e o toggle "Análise Databricks".

**O selo `PREVIEW / MOCK` não é transcrito** — a aba deixa de ser preview.

O toggle reproduz o de `src/features/sinistralidade/components/AnalyticsHeader.tsx`: `aria-pressed`, ícone `fa-diagram-project`, rótulo "Análise Databricks", só renderizado quando `lineage.available`, e a faixa de aviso quando ligado.

- [ ] **Step 2: Escrever o painel de facetas**

`FacetPanel` renderiza as seis facetas com multisseleção, os chips do recorte selecionado, o contador, e os botões "Limpar tudo" e "Aplicar recorte".

Duas coisas do comportamento atual que devem sobreviver, e uma que não:
- Sobrevive: busca dentro da lista de opções quando a faceta tem muitas (cidade traz até 40).
- Sobrevive: o texto de status descrevendo o recorte atual.
- **Não sobrevive:** a nota "Linha de cuidado ainda não está disponível na fonte Databricks", porque essa faceta não existe no payload.

Use `<button>` reais para as opções, com `aria-pressed`. Nada de `div` com handler.

- [ ] **Step 3: Estilos**

Create `src/features/claims/ClaimsTab.module.css`. Copie de `src/dashboard/fragments/gold-preview.html` e do CSS global apenas as regras `pg-*` que os componentes novos usam, renomeando para camelCase de CSS module. Não arraste regras órfãs.

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/claims/
git commit -m "feat(sinistro): cabeçalho e painel de facetas em React"
```

---

### Task 5: KPIs e séries mensal, competência e trimestral

**Files:**
- Create: `src/features/claims/components/ExecutiveKpis.tsx`
- Create: `src/features/claims/components/MonthlySeries.tsx`

**Interfaces:**
- Consumes: `GoldPreview`, `agruparTrimestres` (Task 3), `ChartCard`/`LineChart` de `src/features/sinistralidade/components/charts.tsx`.
- Produces: `<ExecutiveKpis kpis />`, `<MonthlySeries mensal competencia />`.

**Referência de conteúdo:** fragmento linhas 51-58 (os quatro cards de KPI, incluindo os textos `title=` que explicam cada um) e o bloco B1.

- [ ] **Step 1: Escrever os KPIs**

Quatro cards, de `kpis`: sinistro do último mês fechado, custo por utilizante na janela de 12 meses, utilizantes no mês, e share de reembolso.

Os atributos `title=` do fragmento contêm explicações no formato *O QUE É / POR QUE EXISTE / SINAL / ARMADILHA*, escritas por quem conhece o negócio. **Preserve esse texto** — ele é conhecimento, não decoração. Nada de valores numéricos: só os do payload.

Cada card recebe `lineageId="claims.kpis"`.

- [ ] **Step 2: Escrever as séries**

`MonthlySeries` renderiza três `ChartCard`:

1. Série mensal por data de atendimento — `lineageId="claims.monthly"`, título deixando claro o eixo. Meses com `parcial: true` recebem tratamento visual distinto; `LineChart` já aceita `partialMonths`.
2. Série por competência de cobrança — `lineageId="claims.competency"`. O subtítulo diz o que a diferencia da anterior: fatura contra atendimento.
3. Série trimestral — `lineageId="claims.quarterly"`, alimentada por `agruparTrimestres(mensal)`. O eixo de utilizantes usa `utilizantes_media_mensal` e o rótulo diz "média mensal", porque somar utilizantes entre meses conta a mesma pessoa duas vezes.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/claims/components/
git commit -m "feat(sinistro): KPIs e séries mensal, competência e trimestral"
```

---

### Task 6: Composição, lotações e concentração

**Files:**
- Create: `src/features/claims/components/EventMix.tsx`
- Create: `src/features/claims/components/Locations.tsx`
- Create: `src/features/claims/components/Concentration.tsx`

**Interfaces:**
- Consumes: `GoldPreview`; `ChartCard`, `StackedBarChart`, `ParetoChart` de `charts.tsx`.
- Produces: `<EventMix data />`, `<Locations lotacoes />`, `<Concentration concentracao prestadores />`.

**Referência de conteúdo:** fragmento, blocos B2, B3 e os dois painéis B4.

- [ ] **Step 1: Composição por tipo de evento**

`EventMix` consome `composicao_tipo_evento` com `StackedBarChart`. `lineageId="claims.event-mix"`.

- [ ] **Step 2: Lotações**

`Locations` consome `lotacoes` com `ParetoChart`, ordenado por sinistro. `lineageId="claims.locations"`.

A barra "Sem lotação" recebe destaque visual próprio e a nota que o fragmento já traz: o dado falta **na origem**, não no cálculo — é assunto para levar à operadora.

- [ ] **Step 3: Concentração e prestadores**

`Concentration` renderiza dois painéis lado a lado.

Concentração (`lineageId="claims.concentration"`): os tiles de Top 1% e Top 5% a partir de `concentracao`, com o número de pessoas do Top 1%. Só agregados — nenhuma identificação individual sai deste bloco.

Prestadores (`lineageId="claims.providers"`): a tabela do Top N de `prestadores.top`, com o rodapé indicando quanto o Top 10 soma e o total de prestadores, calculados de `prestadores.total_prestadores` e `sinistro_total`. Nada cravado.

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/claims/components/
git commit -m "feat(sinistro): composição por evento, lotações e concentração"
```

---

### Task 7: Internação, impacto Sanus, jornada, top utilizantes e metodologia

**Files:**
- Create: `src/features/claims/components/Hospitalization.tsx`
- Create: `src/features/claims/components/SanusImpact.tsx`
- Create: `src/features/claims/components/SanusJourney.tsx`
- Create: `src/features/claims/components/TopUsers.tsx`
- Create: `src/features/claims/components/Methodology.tsx`

**Interfaces:**
- Consumes: `GoldPreview`; `ChartCard`, `ParetoChart` de `charts.tsx`.
- Produces: `<Hospitalization internacao saudeMental />`, `<SanusImpact impacto comparacao />`, `<SanusJourney jornada />`, `<TopUsers topUtilizantes />`, `<Methodology />`.

**Referência de conteúdo:** fragmento, blocos B5 (dois painéis), B6, B7, B8, B4+ e o card de metodologia; e `public/scripts/gold-preview.js`, funções `renderComparacaoMadura`, `renderJornada`, `deltaBadge`, `deltaText`.

- [ ] **Step 1: Internação e saúde mental**

`Hospitalization`: custo por agrupamento clínico via `ParetoChart` sobre `internacao.por_agrupamento` (`lineageId="claims.hospitalization"`), mais o painel de saúde mental sobre `saude_mental` (`lineageId="claims.mental-health"`).

O painel de saúde mental mostra o share como **intervalo**, não número único, porque parte do custo não tem classificação: use `share_flag` e `share_sem_classificacao` para exibir o limite honesto, como o fragmento já faz. Não colapse num valor só.

Estatísticas de internação (`internacoes_distintas`, `custo_medio`, `duracao_mediana_dias`, `duracao_p90_dias`) entram como fatos no painel. A função `median` que vivia em `claims.js` **não é necessária**: o servidor já devolve mediana e p90 calculados.

- [ ] **Step 2: Impacto Sanus e comparação madura**

`SanusImpact` renderiza B6 e B7. As variações percentuais entre janelas vêm prontas do payload em `comparacao_madura.delta`; se algum valor for nulo, mostre travessão, nunca zero.

Preserve o texto de metodologia que ambos os blocos trazem no payload (`impacto_sanus.metodologia`, `comparacao_madura.metodologia`), inclusive a ressalva de que é associação temporal e não causalidade. `lineageId="claims.sanus-impact"` e `"claims.mature-comparison"`.

- [ ] **Step 3: Jornada Sanus**

`SanusJourney` consome `jornada_sanus`: alcance por serviço e as faixas de proximidade. `lineageId="claims.sanus-journey"`.

Preserve a ressalva de cobertura parcial para dependentes — a ponte é por CPF do titular.

- [ ] **Step 4: Top utilizantes**

`TopUsers` consome `top_utilizantes`. `lineageId="claims.top-users"`.

O bloco é colapsado por padrão, como hoje, e exibe o aviso que vem em `top_utilizantes.aviso` antes da lista. As chaves já chegam mascaradas do servidor (`maskPerson`) — **não tente reverter nem exibir identificador bruto**.

- [ ] **Step 5: Metodologia**

`Methodology` é o card de texto estático do rodapé, transcrito do fragmento. Sem `lineageId`: não representa um número.

- [ ] **Step 6: Verificar**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/claims/components/
git commit -m "feat(sinistro): internação, impacto Sanus, jornada e top utilizantes"
```

---

### Task 8: Montagem da aba e conferência visual

**Files:**
- Create: `src/features/claims/ClaimsTab.tsx`
- Modify: `src/features/claims/ClaimsAnalysisTab.tsx` (passa a reexportar `ClaimsTab`)

**Interfaces:**
- Consumes: tudo das Tasks 3 a 7; `LineageProvider`, `LineageDrawer`, `BlockState` de `src/features/sinistralidade/components/`.
- Produces: `<ClaimsTab />`, renderizado sob o id de aba `analise-sinistro`.

- [ ] **Step 1: Montar a aba**

`ClaimsTab` compõe: `LineageProvider available={data?.fonte.role === "full"}` envolvendo cabeçalho, painel de facetas, os componentes de conteúdo na ordem do fragmento, e `LineageDrawer` no fim.

O estado é da aba, não do bloco: enquanto `status === "loading"`, a aba mostra carregamento; `"error"` mostra erro com repetir; `"forbidden"` mostra indisponível para o perfil. Só com `"ready"` os blocos renderizam.

A seção raiz mantém `id="tab-analise-sinistro"` e a classe `tab-content`, como as outras abas, para o `core.js` continuar mostrando e escondendo corretamente.

- [ ] **Step 2: Redirecionar o re-export existente**

`src/features/claims/ClaimsAnalysisTab.tsx` hoje reexporta `FeatureTab`. Passa a reexportar `ClaimsTab`. Não apague o arquivo nesta task — a Task 9 mexe em quem o consome.

- [ ] **Step 3: Verificar tipos, lint e build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: Conferência visual — passo obrigatório, não pule**

Run: `npm run dev`

Entre com `DASHBOARD_AUTH_USER`/`DASHBOARD_AUTH_PASSWORD` do `.env`, abra Sinistralidade → Análise Sinistro e confira, bloco a bloco:

1. Os 15 blocos aparecem e trazem números.
2. Compare lado a lado com a aba Preview Gold, que ainda existe neste ponto: **os números têm que ser idênticos**. Divergência aqui é bug de transcrição, não de dados.
3. Aplicar uma faceta recalcula tudo; "Limpar tudo" volta ao estado cheio.
4. Ligar o modo Análise Databricks põe selo em cada bloco sem colidir com título ou controle.
5. Clicar num selo abre a gaveta com a tabela e as colunas certas.
6. Nenhum número de fallback: com o dev server no ar, derrube a rede do navegador e confirme que a aba mostra erro, e não valores de 10/jul.

Registre o que viu em cada item. Se não conseguir abrir o navegador, **diga isso explicitamente** em vez de sugerir que conferiu.

- [ ] **Step 5: Commit**

```bash
git add src/features/claims/
git commit -m "feat(sinistro): monta a aba Análise Sinistro em React"
```

---

### Task 9: Consolidação da navegação e remoção do legado

**Files:**
- Modify: `src/features/dashboard/components/DashboardShell.tsx` (`navSections`)
- Modify: `src/dashboard/DashboardTabs.tsx:23-24`
- Modify: `public/scripts/features/core.js:277` e `:1364`
- Modify: `app/page.tsx:11`
- Modify: `public/scripts/dashboard.js:2`
- Modify: `docs/architecture.md`
- Delete: `public/scripts/gold-preview.js`, `public/scripts/features/claims.js`, `src/dashboard/fragments/gold-preview.html`, `src/dashboard/fragments/claims-analysis.html`, `src/features/claims/GoldPreviewTab.tsx`

**Interfaces:**
- Consumes: `<ClaimsTab />` (Task 8).
- Produces: navegação com 11 abas; nenhum consumidor dos arquivos removidos.

- [ ] **Step 1: Remover a aba da navegação**

Em `DashboardShell.tsx`, na seção `"Sinistralidade"` de `navSections`, remova a linha `["preview-gold", "Preview Gold", "fa-layer-group"]`. Ficam duas entradas.

- [ ] **Step 2: Trocar o que a aba renderiza**

Em `src/dashboard/DashboardTabs.tsx`, as duas linhas viram uma:

```tsx
      <ClaimsAnalysisTab />
```

Remova o import e o uso de `GoldPreviewTab` e a leitura dos dois fragmentos do objeto `fragments`.

- [ ] **Step 3: Desligar o despacho legado**

Em `public/scripts/features/core.js`:

- Linha ~1364: remova `else if (activeTab === 'analise-sinistro') renderAnaliseSinistro();`
- Linha ~277: `isSinistroTab` deixa de listar `'preview-gold'`; fica `tab === 'analise-sinistro' || tab === 'sinistralidade-v2'`
- Linhas ~678-683: o bloco que chama `renderAnaliseSinistro()` — remova a chamada, preservando o resto do bloco, que ajusta o texto de filtro e continua valendo para as abas de sinistralidade.

Confirme com `grep -n 'renderAnaliseSinistro' public/scripts/features/core.js` que não sobrou nenhuma referência.

- [ ] **Step 4: Remover o carregamento dos scripts**

Em `app/page.tsx`, remova a linha `<Script src="/scripts/gold-preview.js..." />`.

Em `public/scripts/dashboard.js`, remova `"/scripts/features/claims.js?v=..."` do array `chunks`.

- [ ] **Step 5: Apagar os arquivos**

```bash
git rm public/scripts/gold-preview.js public/scripts/features/claims.js \
       src/dashboard/fragments/gold-preview.html src/dashboard/fragments/claims-analysis.html \
       src/features/claims/GoldPreviewTab.tsx
```

Confirme que nada os referencia:

```bash
grep -rn 'gold-preview\.js\|claims\.js\|GoldPreviewTab\|preview-gold' src app public docs --include='*.ts' --include='*.tsx' --include='*.js' --include='*.md'
```

Ocorrências legítimas que podem sobrar: menções em documentos históricos e o nome da rota `/api/gold-preview`, que continua existindo. Qualquer import ou referência de runtime é erro.

- [ ] **Step 6: Atualizar a documentação**

Em `docs/architecture.md`, a tabela de rotas e o texto que diz "dez abas" estão desatualizados — a navegação tinha 12 e passa a ter 11. Corrija a contagem e remova a menção ao fragmento de Preview Gold.

- [ ] **Step 7: Verificar**

Run: `npm run typecheck && npm run lint && npm run build && npm test`
Expected: PASS. O build falha se algum import apontar para arquivo removido.

- [ ] **Step 8: Conferência visual da navegação**

Run: `npm run dev`

Confirme: a seção Sinistralidade lista duas abas; a Análise Sinistro carrega o conteúdo novo; as outras nove abas continuam funcionando — em especial as que dependem do `core.js`, já que ele foi editado. Abra pelo menos Demográfica, Sessões e Qualidade Operacional.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(sinistro): consolida a seção em duas abas e remove o legado"
```

---

### Task 10: E2E

**Files:**
- Modify: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1 a 9.
- Produces: nenhum artefato consumido adiante.

- [ ] **Step 1: Ajustar o teste de navegação existente**

O teste que percorre as abas vai quebrar porque uma sumiu — e quebra pelo motivo certo. Atualize a lista para as 11 abas atuais, sem `preview-gold`.

- [ ] **Step 2: Escrever o teste da aba nova**

Acrescente a `tests/e2e/dashboard.spec.ts`, seguindo o padrão de login já usado no arquivo:

```ts
test("Análise Sinistro carrega da Gold, filtra e abre linhagem", async ({ page }) => {
  await page.goto("/");
  await page.fill("#auth-user", process.env.DASHBOARD_AUTH_USER as string);
  await page.fill("#auth-password", process.env.DASHBOARD_AUTH_PASSWORD as string);
  await page.click(".auth-submit");

  await page.click('[data-tab="analise-sinistro"]');

  // KPIs vêm da API; timeout largo porque a consulta bate no Databricks.
  const kpis = page.locator("#tab-analise-sinistro").getByText(/Sinistro · último mês fechado/);
  await expect(kpis).toBeVisible({ timeout: 60000 });

  // A aba não existe mais na navegação.
  await expect(page.locator('[data-tab="preview-gold"]')).toHaveCount(0);

  // Modo de linhagem: o selo aparece e a gaveta abre com a fonte certa.
  const toggle = page.getByRole("button", { name: "Análise Databricks" });
  await expect(toggle).toBeVisible();
  await toggle.click();

  const selo = page.getByRole("button", { name: /Ver linhagem Databricks de/ }).first();
  await selo.click();

  const gaveta = page.getByRole("complementary", { name: "Linhagem Databricks" });
  await expect(gaveta).toBeVisible();
  await expect(gaveta).toContainText("gold_sinistro_evento_v2");
});
```

- [ ] **Step 3: Rodar**

Run: `npm run test:e2e -- --grep "Análise Sinistro"`
Expected: PASS. A suíte bate num warehouse Databricks real e leva minutos.

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npm run test:e2e`
Expected: os testes de linhagem da Visão 360 e de navegação passam. **A falha pré-existente da aba "Petit Comitê MDS" continua** — está registrada como dívida em `docs/sinistralidade/IMPLEMENTACAO.md`. Confirme que é a mesma falha de antes e não uma regressão nova.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/dashboard.spec.ts
git commit -m "test(sinistro): E2E da aba consolidada e da navegação com 11 abas"
```

---

## Verificação final contra os critérios de aceite da spec

| Critério | Onde é verificado |
|---|---|
| Seção com duas abas; `preview-gold` não existe | Task 9 Steps 1-5; E2E na Task 10 |
| Os 15 blocos renderizam com os dados atuais | Tasks 5-7; conferência lado a lado na Task 8 Step 4 |
| Série por competência ao lado da de atendimento, cada uma rotulada | Task 1 Steps 5-6; Task 5 Step 2 |
| Modo Análise Databricks funciona nesta aba | Task 2; Task 8 Step 4; E2E na Task 10 |
| Nenhum número cravado nos componentes | Task 8 Step 4 item 6; mais `grep -rnE 'R\$ ?[0-9]' src/features/claims/` sem resultado |
| lint, typecheck, test, build e test:e2e passam | Task 10 Steps 3-4 |
| Legado removido e sem referências | Task 9 Step 5 |
