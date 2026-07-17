import { describe, expect, it } from "vitest";
import { longitudinalEnvelopeSchema } from "../../src/contracts/sinistralidade-v2";
import { escape } from "../../src/server/databricks/client";
import type { ResolvedPeriod } from "../../src/server/sinistralidade/period-gate";
import {
  buildEnvelope,
  growth,
  maskedBeneficiaryLabel,
  movingAverage,
  suppressSmallGroup,
} from "../../src/server/sinistralidade/serializers";

describe("serialização longitudinal", () => {
  it("crescimento nunca é calculado sobre base zero ou ausente", () => {
    expect(growth(100, 50)).toEqual({ state: "valid", pct: 100 });
    expect(growth(50, 100)).toEqual({ state: "valid", pct: -50 });
    expect(growth(100, 0)).toEqual({ state: "new", pct: null });
    expect(growth(0, 0)).toEqual({ state: "not_comparable", pct: null });
    expect(growth(100, null)).toEqual({ state: "not_comparable", pct: null });
    expect(growth(null, 100)).toEqual({ state: "not_comparable", pct: null });
  });

  it("média móvel de 3 meses exige janela completa e ignora buracos", () => {
    expect(movingAverage([10, 20, 30, 40])).toEqual([null, null, 20, 30]);
    expect(movingAverage([10, null, 30, 40])).toEqual([null, null, null, null]);
  });

  it("mascara beneficiário sem expor a chave completa", () => {
    const key = "f".repeat(64);
    expect(maskedBeneficiaryLabel(key)).toBe("Beneficiário ffffffff");
    expect(maskedBeneficiaryLabel(key)).not.toContain(key);
  });

  it("suprime pequenos grupos apenas para perfis externos (GOV-08)", () => {
    expect(suppressSmallGroup(3, true)).toBeNull();
    expect(suppressSmallGroup(3, false)).toBe(3);
    expect(suppressSmallGroup(0, true)).toBe(0);
    expect(suppressSmallGroup(5, true)).toBe(5);
    expect(suppressSmallGroup(null, true)).toBeNull();
  });

  it("escape neutraliza aspas e barra invertida em literais SQL", () => {
    expect(escape("O'Brien")).toBe("O''Brien");
    expect(escape("termina em \\")).toBe("termina em \\\\");
    expect(escape("mix \\' perigoso")).toBe("mix \\\\'' perigoso");
  });

  it("envelope construído valida contra o schema do contrato", () => {
    const period: ResolvedPeriod = {
      state: "partial",
      requested: { endMonth: "2026-05", windowMonths: 6, includePartial: true },
      effective: {
        startMonth: "2025-12",
        endMonth: "2026-05",
        months: [
          { month: "2025-12", status: "unknown" },
          { month: "2026-05", status: "partial" },
        ],
      },
      usableMonths: ["2025-12", "2026-05"],
      warnings: ["Períodos parciais ou não fechados incluídos: não use para comparações oficiais."],
    };
    const envelope = buildEnvelope({
      scope: "timeline",
      companyKey: "b".repeat(64),
      period,
      units: { custo: "R$" },
      coverage: { person: 1, episode: 0.99, family: 0.7, procedure: 1, provider: 1, cid: 0.3, eligibility: "unavailable" },
      warnings: ["Aviso adicional"],
      qualityRunId: "longitudinal-baseline-2026-07-16",
      updatedAt: null,
    });
    expect(longitudinalEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.state).toBe("partial");
    expect(envelope.warnings).toHaveLength(2);
    expect(envelope.contract_version).toBe("1.1.0");
    // O frontend não deduz validade por null: o estado sempre acompanha.
    expect(["valid", "partial", "blocked", "not_comparable"]).toContain(envelope.state);
  });
});
