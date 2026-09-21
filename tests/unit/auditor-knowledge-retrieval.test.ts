import { describe, expect, it } from "vitest";
import { selectKnowledgeContext } from "../../lib/auditor/knowledge-retrieval";

describe("auditor knowledge retrieval", () => {
  it("prioritizes excerpts containing codes from the case", () => {
    const context = selectKnowledgeContext([
      { title: "M.A.M.E.", text: "Introdução geral.\n\nRegras administrativas sem código." },
      { title: "DUT", text: "Introdução da DUT.\n\nO procedimento TUSS 123456 exige critério clínico específico." },
    ], "O código TUSS 123456 possui cobertura?", 20_000);

    expect(context).toContain("TUSS 123456");
    expect(context.indexOf("DUT")).toBeLessThan(context.indexOf("M.A.M.E."));
  });

  it("keeps the selected context inside the configured budget", () => {
    const context = selectKnowledgeContext([
      { title: "Manual", text: Array.from({ length: 100 }, (_, index) => `Parágrafo ${index} ${"regra ".repeat(100)}`).join("\n\n") },
    ], "regra", 12_000);

    expect(context.length).toBeLessThanOrEqual(12_000);
    expect(context).toContain("Manual");
  });
});
