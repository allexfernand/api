import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lineageRegistry } from "../../src/server/sinistralidade/lineage";
import { lineageRegistrySchema } from "../../src/contracts/sinistralidade-v2";
import { TABLES } from "../../src/server/sinistralidade/query-runner";
import { sinistralidadeV2Handler } from "../../src/server/sinistralidade/index";

const registro = lineageRegistry();

// B3: rede de segurança barata contra nome de coluna fabricado. Já aconteceu
// (oito entradas com colunas erradas e uma com colunas inexistentes, todos os
// testes verdes) — humanos é que pegaram, à mão, duas vezes. Este teste checa,
// por entrada, que toda coluna declarada aparece no texto bruto do(s)
// arquivo(s) que a implementam pelo menos duas vezes: uma na própria
// constante de linhagem, outra na SQL ao lado. Não prova que a coluna existe
// no Databricks — só que alguém não digitou um nome que não aparece em lugar
// nenhum do código.
const QUERIES_DIR = "../../src/server/sinistralidade/queries";
const SERVER_DIR = "../../src/server/sinistralidade";
const ROUTE_GOLD_PREVIEW = "../../src/server/routes/gold-preview.ts";

// Mapa explícito por id, e não inferência: a maioria das entradas mora no
// mesmo arquivo que a consulta que descreve, mas duas famílias de exceção
// precisam de um segundo arquivo:
//   - qualquer entrada com a fonte TABLES.monthStatus: a SQL que lê
//     sinistralidade_month_status_v2 mora em period-gate.ts, não ao lado da
//     constante (ela só referencia o gate, não o consulta).
//   - kpis-lineage.ts: os nove KPIs são agregados em JavaScript sobre o
//     resultado do escopo `timeline`; as colunas que eles leem são
//     selecionadas na SQL de timeline.ts, não em kpis-lineage.ts.
const ENTRY_SOURCE_FILES: Record<string, string[]> = {
  "timeline.monthly": [`${QUERIES_DIR}/timeline.ts`, `${SERVER_DIR}/period-gate.ts`],
  "timeline.competency": [`${QUERIES_DIR}/timeline.ts`],
  "event-mix.cost": [`${QUERIES_DIR}/event-mix.ts`, `${SERVER_DIR}/period-gate.ts`],
  "top-users-window.table": [`${QUERIES_DIR}/rankings.ts`, `${SERVER_DIR}/period-gate.ts`],
  "user-detail": [`${QUERIES_DIR}/rankings.ts`],
  "procedure-trends.pareto": [`${QUERIES_DIR}/procedures.ts`, `${SERVER_DIR}/period-gate.ts`],
  "procedure-trends.scatter": [`${QUERIES_DIR}/procedures.ts`],
  "procedure-trends.monthly": [`${QUERIES_DIR}/procedures.ts`],
  "hospitalization-trends.monthly": [`${QUERIES_DIR}/hospitalizations.ts`, `${SERVER_DIR}/period-gate.ts`],
  "provider-trends.monthly": [`${QUERIES_DIR}/providers.ts`, `${SERVER_DIR}/period-gate.ts`],
  "provider-trends.network": [`${QUERIES_DIR}/providers.ts`],
  "concentration.monthly": [`${QUERIES_DIR}/concentration.ts`, `${SERVER_DIR}/period-gate.ts`],
  "company-benchmark.table": [`${QUERIES_DIR}/concentration.ts`, `${SERVER_DIR}/period-gate.ts`],
  "family-timeline.relative": [`${QUERIES_DIR}/family-care.ts`, `${SERVER_DIR}/period-gate.ts`],
  "care-timeline.matrix": [`${QUERIES_DIR}/family-care.ts`, `${SERVER_DIR}/period-gate.ts`],
  "ps-trends.monthly": [`${QUERIES_DIR}/family-care.ts`, `${SERVER_DIR}/period-gate.ts`],
  "kpi.gross_cost": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.utilizers": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.service_quantity": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.hospitalization_episodes": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.utilizing_families": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.cost_per_utilizer": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.services_per_utilizer": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.cost_per_eligible_life": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "kpi.hospitalizations_per_thousand_lives": [`${QUERIES_DIR}/kpis-lineage.ts`, `${QUERIES_DIR}/timeline.ts`],
  "claims.freshness": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.kpis": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.monthly": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.competency": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.quarterly": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.event-mix": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.locations": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.concentration": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.providers": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.hospitalization": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.mental-health": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.sanus-impact": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.mature-comparison": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.sanus-journey": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
  "claims.top-users": [`${QUERIES_DIR}/gold-preview-lineage.ts`, ROUTE_GOLD_PREVIEW],
};

const fileTextCache = new Map<string, string>();
function readSourceFiles(relativePaths: string[]): string {
  return relativePaths
    .map((relative) => {
      if (!fileTextCache.has(relative)) {
        fileTextCache.set(relative, readFileSync(join(__dirname, relative), "utf8"));
      }
      return fileTextCache.get(relative) as string;
    })
    .join("\n");
}

function countOccurrences(text: string, column: string): number {
  const escaped = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(`\\b${escaped}\\b`, "g"));
  return matches ? matches.length : 0;
}

describe("colunas declaradas batem com o código (evita nome fabricado)", () => {
  it("toda entrada tem um mapeamento de arquivo-fonte", () => {
    const semMapa = registro.entries.map((entry) => entry.id).filter((id) => !ENTRY_SOURCE_FILES[id]);
    expect(semMapa).toEqual([]);
  });

  it("toda coluna declarada aparece pelo menos duas vezes no(s) arquivo(s) de origem", () => {
    const problemas: string[] = [];
    for (const entry of registro.entries) {
      const arquivos = ENTRY_SOURCE_FILES[entry.id];
      if (!arquivos) continue; // já coberto pelo teste anterior
      const texto = readSourceFiles(arquivos);
      for (const source of entry.sources) {
        for (const column of source.columns) {
          const ocorrencias = countOccurrences(texto, column);
          if (ocorrencias < 2) {
            problemas.push(
              `${entry.id}: coluna "${column}" (fonte ${source.object}) aparece ${ocorrencias}x em ${arquivos.join(", ")}`,
            );
          }
        }
      }
    }
    // Compara como texto, não como array: `expect(array).toEqual([])` falha
    // com "expected [ Array(1) ] to deeply equal []" e engole justamente a
    // mensagem que diz QUAL coluna está errada — que é o motivo de este teste
    // existir. Como string, o diff imprime a lista inteira.
    expect(problemas.join("\n")).toBe("");
  });
});

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

  // O mesmo objeto pode aparecer mais de uma vez em `sources` (claims.kpis lê
  // a Gold duas vezes, com papéis diferentes) — o LineageDrawer keya por
  // object+índice justamente por isso. O que não deve existir é a MESMA fonte
  // repetida: (object, role) idênticos são fonte duplicada por copiar-colar.
  it("não repete a mesma fonte (object + role) dentro de uma entrada", () => {
    const repetidas = registro.entries.flatMap((entry) => {
      const vistas = new Set<string>();
      return entry.sources
        .map((source) => `${source.object}::${source.role}`)
        .filter((chave) => (vistas.has(chave) ? true : (vistas.add(chave), false)))
        .map((chave) => `${entry.id} -> ${chave}`);
    });
    expect(repetidas).toEqual([]);
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

  it("tem 40 entradas no total", () => {
    expect(registro.entries).toHaveLength(40);
  });

  it("cobre os blocos da aba Análise Sinistro", () => {
    const ids = registro.entries.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "claims.freshness",
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
});

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
    expect((ctx.body as { lineage: { entries: unknown[] } }).lineage.entries).toHaveLength(40);
    expect(ctx.headers["Cache-Control"]).toBe("private, max-age=3600");
  });

  it("recusa o papel mds com 403 sem vazar nome de tabela", async () => {
    const ctx = fakeRes();
    await sinistralidadeV2Handler(
      { method: "GET", query: { scope: "lineage" }, headers: { authorization: basic("mds", "senha-mds") } },
      ctx.res,
    );
    expect(ctx.statusCode).toBe(403);
    // Esta é a asserção de segurança de todo o recurso: o papel mds nunca
    // pode ver de onde os números vêm, nem por acidente no corpo do erro.
    const corpo = JSON.stringify(ctx.body);
    for (const tabela of Object.values(TABLES)) {
      expect(corpo).not.toContain(tabela);
    }
    expect(corpo).not.toMatch(/hive_metastore/i);
    expect(ctx.body).toEqual({ error: "Usuário MDS restrito ao dashboard Petit Comitê MDS." });
  });
});
