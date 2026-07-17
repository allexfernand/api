// Escopo `event-mix`: composição mensal de custo/uso por tipo de evento.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { getCell, toInt, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const EVENT_MIX_UNITS = {
  custo: "R$",
  linhas: "linhas de cobrança",
  servicos: "serviços",
  utilizantes: "pessoas",
  internacoes: "episódios",
  participacao: "fração (0–1)",
};

export async function eventMixScope(q: QueryRunner, companyKey: string, period: ResolvedPeriod) {
  if (!period.usableMonths.length) return { months: [], window_totals: [] };
  const rows = await q(
    `SELECT month_key, tipo_evento, linhas_cobranca, quantidade_servicos, utilizantes,
      episodios_internacao, custo_assistencial_bruto, participacao_custo_mes
    FROM ${TABLES.martEventoMes}
    WHERE company_key = '${companyKey}' AND month_key IN (${monthsInSql(period.usableMonths)})
    ORDER BY month_key, custo_assistencial_bruto DESC, tipo_evento`,
  );

  const months = rows.map((row) => ({
    month: String(getCell(row[0])),
    event_type: String(getCell(row[1]) || "Sem classificação"),
    billing_lines: toInt(row[2]),
    service_quantity: toNum(row[3]),
    utilizers: toInt(row[4]),
    hospitalization_episodes: toInt(row[5]),
    gross_cost: toNum(row[6]),
    month_cost_share: toNum(row[7]),
  }));

  // Totais do período por evento, com desempate determinístico por nome.
  const totals = new Map<string, { gross_cost: number; service_quantity: number }>();
  for (const entry of months) {
    const current = totals.get(entry.event_type) ?? { gross_cost: 0, service_quantity: 0 };
    current.gross_cost += entry.gross_cost;
    current.service_quantity += entry.service_quantity;
    totals.set(entry.event_type, current);
  }
  const windowCost = [...totals.values()].reduce((total, entry) => total + entry.gross_cost, 0);
  const window_totals = [...totals.entries()]
    .map(([event_type, entry]) => ({
      event_type,
      gross_cost: Math.round(entry.gross_cost * 100) / 100,
      service_quantity: entry.service_quantity,
      window_cost_share: windowCost ? Math.round((entry.gross_cost / windowCost) * 1_000_000) / 1_000_000 : null,
    }))
    .sort((a, b) => b.gross_cost - a.gross_cost || a.event_type.localeCompare(b.event_type));

  return { months, window_totals };
}
