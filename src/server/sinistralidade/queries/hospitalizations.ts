// Escopo `hospitalization-trends`: internações gerais, saúde mental e
// agrupamentos. Episódios sempre por count(distinct episode_key) (GOV-02).

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { getCell, toBool, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const HOSPITALIZATION_UNITS = {
  episodios: "episódios",
  utilizantes: "pessoas",
  custo: "R$",
  custo_medio: "R$/episódio",
  duracao: "dias",
  cobertura: "%",
};

export async function hospitalizationTrendsScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { mentalHealth?: boolean },
) {
  if (!period.usableMonths.length) return { monthly: [], groups: [], providers: [] };
  const months = monthsInSql(period.usableMonths);
  const mentalFilter = options.mentalHealth === undefined ? "" : ` AND saude_mental = ${options.mentalHealth}`;

  const [monthlyRows, groupRows, providerRows] = await Promise.all([
    q(
      `SELECT month_key, saude_mental, episodios_internacao, utilizantes, custo_total,
        custo_medio_por_episodio, duracao_mediana_dias, duracao_p90_dias, cobertura_duracao
      FROM ${TABLES.martInternacaoMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})${mentalFilter}
      ORDER BY month_key, saude_mental DESC`,
    ),
    q(
      `SELECT agrupamento_internacao, sum(episodios_internacao), sum(utilizantes),
        round(sum(custo_total), 2),
        round(sum(custo_total) / nullif(sum(episodios_internacao), 0), 2),
        percentile(duracao_mediana_dias, 0.5)
      FROM ${TABLES.martInternacaoGrupoMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      GROUP BY agrupamento_internacao
      ORDER BY 4 DESC, agrupamento_internacao
      LIMIT 20`,
    ),
    q(
      `SELECT prestador_key, max(prestador_label), sum(episodios_internacao), sum(utilizantes),
        round(sum(custo_assistencial_bruto), 2)
      FROM ${TABLES.martPrestadorMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months}) AND episodios_internacao > 0
      GROUP BY prestador_key
      ORDER BY 3 DESC, prestador_key
      LIMIT 10`,
    ),
  ]);

  return {
    monthly: monthlyRows.map((row) => ({
      month: String(getCell(row[0])),
      mental_health: toBool(row[1]),
      episodes: toInt(row[2]),
      utilizers: toInt(row[3]),
      total_cost: toNum(row[4]),
      average_episode_cost: toNullableNum(row[5]),
      median_duration_days: toNullableNum(row[6]),
      p90_duration_days: toNullableNum(row[7]),
      duration_coverage: toNullableNum(row[8]),
    })),
    groups: groupRows.map((row) => ({
      grouping: String(getCell(row[0]) || "Sem agrupamento"),
      episodes: toInt(row[1]),
      monthly_utilizers_sum: toInt(row[2]),
      total_cost: toNum(row[3]),
      average_episode_cost: toNullableNum(row[4]),
      median_duration_days: toNullableNum(row[5]),
    })),
    providers: providerRows.map((row) => ({
      entity_key: String(getCell(row[0])),
      provider: String(getCell(row[1]) || "Prestador não informado"),
      episodes: toInt(row[2]),
      monthly_utilizers_sum: toInt(row[3]),
      gross_cost: toNum(row[4]),
    })),
  };
}
