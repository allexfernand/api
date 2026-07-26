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
