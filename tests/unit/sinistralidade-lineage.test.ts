import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lineageRegistry } from "../../src/server/sinistralidade/lineage";
import { lineageRegistrySchema } from "../../src/contracts/sinistralidade-v2";
import { TABLES } from "../../src/server/sinistralidade/query-runner";
import { sinistralidadeV2Handler } from "../../src/server/sinistralidade/index";

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

  it("tem 25 entradas no total", () => {
    expect(registro.entries).toHaveLength(25);
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
