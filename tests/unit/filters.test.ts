import { describe, expect, it } from "vitest";
import { filtersToSearchParams } from "../../src/lib/api/filters";

describe("filtersToSearchParams", () => {
  it("serializa o contrato usado pelos endpoints existentes", () => {
    const params = filtersToSearchParams({
      groups: ["Grupo A", "Grupo B"],
      company: "Empresa A",
      beneficiaryType: "TITULAR",
      partnerBrokerId: "42",
      months: ["2026-01", "2026-02"],
    });

    expect(JSON.parse(params.get("group_names") || "[]")).toEqual(["Grupo A", "Grupo B"]);
    expect(params.get("company")).toBe("Empresa A");
    expect(params.get("type")).toBe("TITULAR");
    expect(params.get("partner_broker_id")).toBe("42");
    expect(params.get("meses")).toBe("2026-01,2026-02");
  });
});
