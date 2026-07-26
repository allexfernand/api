import { describe, expect, it } from "vitest";
import {
  SINISTRALIDADE_CONTRACT_VERSION,
  legacyScopeSchema,
  lineageEntrySchema,
  lineageRegistrySchema,
  longitudinalEnvelopeSchema,
  longitudinalScopeSchema,
  sinistralidadeQuerySchema,
} from "../../src/contracts/sinistralidade-v2";

const COMPANY = "a".repeat(64);

describe("contrato sinistralidade 1.1.0", () => {
  it("é aditivo: mantém todos os escopos 1.0.0", () => {
    expect(SINISTRALIDADE_CONTRACT_VERSION).toBe("1.2.0");
    for (const scope of ["metadata", "overview", "top10", "bimester", "mental-health", "ps-package", "care-coordination", "family-before-after", "year-over-year"]) {
      expect(legacyScopeSchema.options).toContain(scope);
      expect(sinistralidadeQuerySchema.safeParse({ scope }).success).toBe(true);
    }
  });

  it("expõe os doze escopos longitudinais", () => {
    expect(longitudinalScopeSchema.options).toEqual([
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
    ]);
  });

  it("valida janela, limite e ranking", () => {
    const valid = sinistralidadeQuerySchema.safeParse({
      scope: "timeline",
      company_key: COMPANY,
      end_month: "2026-05",
      window_months: "12",
      ranking_by: "cost",
      limit: "20",
    });
    expect(valid.success).toBe(true);
    expect(valid.success && valid.data.window_months).toBe(12);
    expect(valid.success && valid.data.limit).toBe(20);

    expect(sinistralidadeQuerySchema.safeParse({ scope: "timeline", window_months: "7" }).success).toBe(false);
    expect(sinistralidadeQuerySchema.safeParse({ scope: "timeline", limit: "50" }).success).toBe(false);
    expect(sinistralidadeQuerySchema.safeParse({ scope: "timeline", ranking_by: "alfabetico" }).success).toBe(false);
    expect(sinistralidadeQuerySchema.safeParse({ scope: "user-detail", entity_key: "not-a-key" }).success).toBe(false);
    expect(sinistralidadeQuerySchema.safeParse({ scope: "timeline", end_month: "2026-13" }).success).toBe(false);
  });

  it("include_partial continua padrão false", () => {
    const parsed = sinistralidadeQuerySchema.parse({ scope: "timeline" });
    expect(parsed.include_partial).toBe("false");
  });

  it("envelope longitudinal exige estado explícito e período efetivo", () => {
    const envelope = {
      contract_version: "1.2.0",
      generated_at: new Date().toISOString(),
      company_key: COMPANY,
      scope: "timeline",
      state: "partial",
      requested_period: { end_month: "2026-05", window_months: 12, include_partial: true },
      effective_period: {
        start_month: "2025-06",
        end_month: "2026-05",
        months: [{ month: "2026-05", status: "unknown" }],
      },
      units: { custo: "R$" },
      coverage: { person: 1, episode: 1, family: 0.8, procedure: 1, provider: 1, cid: 0.4, eligibility: "unavailable" },
      warnings: ["Períodos parciais incluídos"],
      quality_run_id: "longitudinal-baseline-2026-07-16",
      updated_at: null,
    };
    expect(longitudinalEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(longitudinalEnvelopeSchema.safeParse({ ...envelope, state: "ok" }).success).toBe(false);
    expect(longitudinalEnvelopeSchema.safeParse({ ...envelope, effective_period: undefined }).success).toBe(false);
  });
});

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
