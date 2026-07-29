import { describe, expect, it } from "vitest";
import { agruparTrimestres } from "../../src/features/claims/quarterly";

const mes = (mes: string, sinistro: number, itens: number, utilizantes: number) => ({
  mes, sinistro, itens, utilizantes, parcial: false, estado: "closed" as const,
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
      mes("2026-01", 100, 10, 5), mes("2026-02", 100, 10, 5), { ...mes("2026-03", 100, 10, 5), parcial: true, estado: "partial" as const },
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
