// Resolução de período e gate de fechamento (GOV-03).
// Regras:
//   * a janela é resolvida ANTES de qualquer cálculo;
//   * meses `partial`/`unknown` só entram com include_partial autorizado, e
//     sempre sinalizados — nunca se misturam silenciosamente a meses fechados;
//   * ausência de cobertura nunca vira zero: meses da janela sem dado
//     permanecem na resposta com status e sem métricas.

import { getCell } from "../databricks/client";
import type { MonthStatusEntry, PeriodStatus, ScopeState, WindowMonths } from "../../contracts/sinistralidade-v2";
import { TABLES, type QueryRunner } from "./query-runner";

export type ResolvedPeriod = {
  state: ScopeState;
  requested: { endMonth: string | null; windowMonths: WindowMonths | null; includePartial: boolean };
  effective: { startMonth: string | null; endMonth: string | null; months: MonthStatusEntry[] };
  /** Meses aprovados para cálculo (fechados, ou todos observados quando include_partial). */
  usableMonths: string[];
  warnings: string[];
};

export function monthSpine(endMonth: string, windowMonths: number): string[] {
  const [year, month] = endMonth.split("-").map(Number);
  const months: string[] = [];
  for (let offset = windowMonths - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function classifyPeriod(
  months: MonthStatusEntry[],
  includePartial: boolean,
): { state: ScopeState; usableMonths: string[]; warnings: string[] } {
  const closed = months.filter((entry) => entry.status === "closed").map((entry) => entry.month);
  const observedNotClosed = months.filter((entry) => entry.status !== "closed");
  const warnings: string[] = [];

  if (!includePartial) {
    if (!closed.length) {
      return {
        state: "blocked",
        usableMonths: [],
        warnings: ["Nenhum mês da janela está formalmente fechado. Ative a visão observada (parcial) ou aguarde o fechamento."],
      };
    }
    if (observedNotClosed.length) {
      warnings.push(`A janela contém ${observedNotClosed.length} mês(es) não fechado(s), excluído(s) do cálculo.`);
    }
    return { state: "valid", usableMonths: closed, warnings };
  }

  if (observedNotClosed.length) {
    warnings.push("Períodos parciais ou não fechados incluídos: não use para comparações oficiais.");
    return { state: "partial", usableMonths: months.map((entry) => entry.month), warnings };
  }
  return { state: "valid", usableMonths: closed, warnings };
}

export async function resolvePeriod(
  q: QueryRunner,
  companyKey: string,
  endMonth: string,
  windowMonths: WindowMonths,
  includePartial: boolean,
): Promise<ResolvedPeriod> {
  const spine = monthSpine(endMonth, windowMonths);
  const rows = await q(
    `SELECT month_key, status FROM ${TABLES.monthStatus}
     WHERE company_key = '${companyKey}' AND month_key IN (${spine.map((month) => `'${month}'`).join(",")})
     QUALIFY row_number() OVER (PARTITION BY month_key ORDER BY updated_at DESC) = 1`,
  );
  const statusByMonth = new Map<string, PeriodStatus>();
  for (const row of rows) {
    const month = String(getCell(row[0]) || "");
    const raw = String(getCell(row[1]) || "unknown").toLowerCase();
    statusByMonth.set(month, raw === "closed" ? "closed" : raw === "partial" ? "partial" : "unknown");
  }
  const months: MonthStatusEntry[] = spine.map((month) => ({
    month,
    status: statusByMonth.get(month) ?? "unknown",
  }));

  const { state, usableMonths, warnings } = classifyPeriod(months, includePartial);
  return {
    state,
    requested: { endMonth, windowMonths, includePartial },
    effective: {
      startMonth: usableMonths[0] ?? null,
      endMonth: usableMonths.at(-1) ?? null,
      months,
    },
    usableMonths,
    warnings,
  };
}

export function monthsInSql(months: string[]) {
  return months.map((month) => `'${month}'`).join(",");
}
