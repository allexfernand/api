// Escopo `hospitalization-trends`: internações gerais, saúde mental e
// agrupamentos. Episódios sempre por count(distinct episode_key) (GOV-02).

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { getCell, toBool, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const HOSPITALIZATION_UNITS = {
  episodios: "episódios",
  utilizantes: "pessoas",
  custo: "R$",
  custo_medio: "R$/episódio",
  duracao: "dias",
  cobertura: "%",
};

export const HOSPITALIZATION_LINEAGE: LineageEntry[] = [
  {
    id: "hospitalization-trends.monthly",
    kind: "block",
    label: "Internações mensais e saúde mental",
    layer: "mart",
    sources: [
      {
        object: TABLES.martInternacaoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "saude_mental",
          "episodios_internacao",
          "utilizantes",
          "custo_total",
        ],
      },
      {
        object: TABLES.martInternacaoGrupoMes,
        role: "quebra por acomodação",
        columns: ["month_key", "acomodacao_internacao", "episodios_internacao", "utilizantes"],
      },
      {
        object: TABLES.martPrestadorMes,
        role: "prestadores que internaram",
        columns: ["month_key", "prestador_key", "prestador_label", "episodios_internacao", "utilizantes"],
      },
    ],
    formula:
      "Episódios = COUNT(DISTINCT episode_key) já consolidado no mart. Custo médio por episódio = custo_total ÷ episodios_internacao.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
      "quando o filtro de saúde mental está ativo, só episódios classificados",
    ],
    notes: [
      "Internação conta ADMISSÕES, não diárias: o episode_key inclui a data de atendimento, e o episódio é atribuído ao mês inicial.",
      "A classificação de saúde mental é aplicada no grão do episódio, não da linha de cobrança.",
    ],
    related: ["timeline.monthly"],
  },
];

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
      `SELECT acomodacao_internacao, sum(episodios_internacao), sum(utilizantes),
        round(sum(custo_total), 2),
        round(sum(custo_total) / nullif(sum(episodios_internacao), 0), 2),
        percentile(duracao_mediana_dias, 0.5)
      FROM ${TABLES.martInternacaoGrupoMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      GROUP BY acomodacao_internacao
      ORDER BY 4 DESC, acomodacao_internacao
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
