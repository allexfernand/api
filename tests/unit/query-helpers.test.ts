import { describe, expect, it } from "vitest";
import {
  nextMonth,
  parseGroupNames,
  parseMonthList,
  pickColumn,
} from "../../src/server/databricks/query-helpers";

describe("query helpers", () => {
  it("normaliza grupos, meses e colunas", () => {
    expect(parseGroupNames({ group_names: '[" A ","B","A"]' })).toEqual(["A", "B"]);
    expect(parseMonthList("2026-02,invalido,2026-01,2026-02")).toEqual(["2026-01", "2026-02"]);
    expect(pickColumn(["ID_UNICO", "Status"], ["id_unico"])).toBe("ID_UNICO");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});
