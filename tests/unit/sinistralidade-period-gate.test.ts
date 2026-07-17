import { describe, expect, it } from "vitest";
import { classifyPeriod, monthSpine } from "../../src/server/sinistralidade/period-gate";
import type { MonthStatusEntry } from "../../src/contracts/sinistralidade-v2";

function months(entries: [string, "closed" | "partial" | "unknown"][]): MonthStatusEntry[] {
  return entries.map(([month, status]) => ({ month, status }));
}

describe("gate de período longitudinal", () => {
  it("gera espinha densa de meses cruzando a virada do ano", () => {
    expect(monthSpine("2026-02", 6)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthSpine("2026-05", 3)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("bloqueia janela sem nenhum mês fechado quando parcial não é autorizado", () => {
    const result = classifyPeriod(months([["2026-04", "unknown"], ["2026-05", "partial"]]), false);
    expect(result.state).toBe("blocked");
    expect(result.usableMonths).toEqual([]);
    expect(result.warnings[0]).toMatch(/formalmente fechado/);
  });

  it("usa somente meses fechados e avisa sobre os excluídos", () => {
    const result = classifyPeriod(months([["2026-03", "closed"], ["2026-04", "closed"], ["2026-05", "partial"]]), false);
    expect(result.state).toBe("valid");
    expect(result.usableMonths).toEqual(["2026-03", "2026-04"]);
    expect(result.warnings[0]).toMatch(/1 mês\(es\) não fechado/);
  });

  it("com parcial autorizado inclui tudo e marca estado partial", () => {
    const result = classifyPeriod(months([["2026-04", "unknown"], ["2026-05", "closed"]]), true);
    expect(result.state).toBe("partial");
    expect(result.usableMonths).toEqual(["2026-04", "2026-05"]);
    expect(result.warnings[0]).toMatch(/não use para comparações oficiais/i);
  });

  it("janela toda fechada permanece valid mesmo com include_partial", () => {
    const result = classifyPeriod(months([["2026-04", "closed"], ["2026-05", "closed"]]), true);
    expect(result.state).toBe("valid");
    expect(result.usableMonths).toEqual(["2026-04", "2026-05"]);
    expect(result.warnings).toEqual([]);
  });
});
