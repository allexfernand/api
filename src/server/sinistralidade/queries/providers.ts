// Escopo `provider-trends`: desempenho e evolução de prestadores, com
// separação rede credenciada × reembolso. prestador_key é opaco.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { escape } from "../../databricks/client";
import { getCell, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const PROVIDER_UNITS = {
  custo: "R$",
  servicos: "serviços",
  utilizantes: "pessoas",
  internacoes: "episódios",
  ticket: "R$/serviço",
  participacao: "%",
};

export async function providerTrendsScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { limit: number; network?: "rede" | "reembolso"; specialty?: string },
) {
  if (!period.usableMonths.length) return { window: [], series: [], network_split: [] };
  const months = monthsInSql(period.usableMonths);
  const networkFilter = options.network ? ` AND reembolso = ${options.network === "reembolso"}` : "";
  const specialtyFilter = options.specialty
    ? ` AND upper(especialidade_principal) LIKE upper('%${escape(options.specialty)}%')`
    : "";

  const windowRows = await q(
    `SELECT prestador_key, max(prestador_label), max(tipo_prestador), max(especialidade_principal),
      sum(linhas_cobranca), sum(quantidade_servicos), sum(utilizantes), sum(episodios_internacao),
      round(sum(custo_assistencial_bruto), 2),
      round(sum(custo_assistencial_bruto) / nullif(sum(quantidade_servicos), 0), 2),
      round(sum(CASE WHEN reembolso THEN custo_assistencial_bruto ELSE 0 END), 2),
      sum(sum(custo_assistencial_bruto)) OVER () AS custo_total
    FROM ${TABLES.martPrestadorMes}
    WHERE company_key = '${companyKey}' AND month_key IN (${months})${networkFilter}${specialtyFilter}
    GROUP BY prestador_key
    ORDER BY 9 DESC, prestador_key
    LIMIT ${options.limit * 2}`,
  );

  const totalCost = windowRows[0] ? toNum(windowRows[0][11]) : 0;
  let cumulative = 0;
  const window = windowRows.slice(0, options.limit).map((row, index) => {
    const grossCost = toNum(row[8]);
    cumulative += grossCost;
    return {
      entity_key: String(getCell(row[0])),
      provider: String(getCell(row[1]) || "Prestador não informado"),
      provider_type: String(getCell(row[2]) || "Sem classificação"),
      specialty: String(getCell(row[3]) || "Sem especialidade"),
      billing_lines: toInt(row[4]),
      service_quantity: toNum(row[5]),
      monthly_utilizers_sum: toInt(row[6]),
      hospitalization_episodes: toInt(row[7]),
      gross_cost: grossCost,
      average_ticket: toNullableNum(row[9]),
      reimbursement_cost: toNum(row[10]),
      cost_share: totalCost ? grossCost / totalCost : null,
      cumulative_cost_share: totalCost ? cumulative / totalCost : null,
      position: index + 1,
    };
  });

  const topKeys = window.slice(0, 5).map((entry) => entry.entity_key);
  const [seriesRows, splitRows] = await Promise.all([
    topKeys.length
      ? q(
          `SELECT prestador_key, month_key, sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2)
          FROM ${TABLES.martPrestadorMes}
          WHERE company_key = '${companyKey}' AND month_key IN (${months})
            AND prestador_key IN (${topKeys.map((key) => `'${key}'`).join(",")})
          GROUP BY prestador_key, month_key ORDER BY month_key`,
        )
      : Promise.resolve([]),
    q(
      `SELECT month_key, reembolso, round(sum(custo_assistencial_bruto), 2), sum(quantidade_servicos)
      FROM ${TABLES.martPrestadorMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      GROUP BY month_key, reembolso ORDER BY month_key`,
    ),
  ]);

  const seriesByKey = new Map<string, { month: string; service_quantity: number; gross_cost: number }[]>();
  for (const row of seriesRows) {
    const key = String(getCell(row[0]));
    const list = seriesByKey.get(key) ?? [];
    list.push({ month: String(getCell(row[1])), service_quantity: toNum(row[2]), gross_cost: toNum(row[3]) });
    seriesByKey.set(key, list);
  }

  return {
    window,
    series: topKeys.map((key) => ({
      entity_key: key,
      provider: window.find((entry) => entry.entity_key === key)?.provider ?? key,
      monthly: period.usableMonths.map((month) => {
        const found = (seriesByKey.get(key) ?? []).find((entry) => entry.month === month);
        return found ?? { month, service_quantity: 0, gross_cost: 0 };
      }),
    })),
    network_split: splitRows.map((row) => ({
      month: String(getCell(row[0])),
      reimbursement: String(getCell(row[1])).toLowerCase() === "true",
      gross_cost: toNum(row[2]),
      service_quantity: toNum(row[3]),
    })),
  };
}
