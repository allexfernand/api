// Escopo `procedure-trends`: rankings, Pareto, série mensal e dispersão de
// procedimentos/serviços. Linha de conta, quantidade de serviço e episódio
// são sempre colunas separadas para evitar dupla leitura.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { createSqlParams } from "../../databricks/client";
import { fetchCoveredMonths, getCell, growth, toInt, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const PROCEDURE_UNITS = {
  custo: "R$",
  reembolso: "R$",
  share_reembolso: "fração (0–1)",
  custo_medio: "R$/serviço",
  servicos: "serviços",
  linhas: "linhas de cobrança",
  utilizantes: "pessoas",
  internacoes: "episódios",
  participacao: "fração (0–1)",
};

const PROCEDURE_SOURCES = [
  {
    object: TABLES.martProcedimentoMes,
    role: "fato principal",
    columns: [
      "procedimento_key",
      "month_key",
      "descricao_comercial",
      "grupo_comercial",
      "linhas_cobranca",
      "quantidade_servicos",
      "utilizantes",
      "episodios_internacao",
      "custo_assistencial_bruto",
    ],
  },
  {
    object: TABLES.gold,
    role: "custo de reembolso por procedimento na janela",
    columns: ["codigo_procedimento_operadora", "month_key", "flag_reembolso", "custo_assistencial_bruto", "flag_data_suspeita", "company_key"],
  },
];

const PROCEDURE_FILTERS = [
  "company_key do escopo do usuário, aplicado no SQL",
  "meses aprovados pelo gate de fechamento",
  "quando há filtro de tipo de evento, os códigos vêm de gold_sinistro_evento_v2",
];

export const PROCEDURE_LINEAGE: LineageEntry[] = [
  {
    id: "procedure-trends.pareto",
    kind: "block",
    label: "Pareto de procedimentos por custo",
    layer: "mart",
    sources: [
      ...PROCEDURE_SOURCES,
      {
        object: TABLES.monthStatus,
        role: "gate de fechamento do período",
        columns: ["company_key", "month_key", "status", "updated_at"],
      },
    ],
    formula:
      "Procedimentos ordenados por SUM(custo_assistencial_bruto) na janela, com participação acumulada sobre o custo total. Reembolso = SUM(custo_assistencial_bruto onde flag_reembolso = true) por procedimento.",
    filters: PROCEDURE_FILTERS,
    notes: ["Mostra quantos procedimentos concentram a maior parte do custo."],
    related: ["procedure-trends.scatter", "procedure-trends.monthly"],
  },
  {
    id: "procedure-trends.scatter",
    kind: "block",
    label: "Dispersão: volume contra custo médio",
    layer: "mart",
    sources: PROCEDURE_SOURCES,
    formula:
      "Cada ponto é um procedimento: eixo de volume = SUM(quantidade_servicos); eixo de custo médio = SUM(custo_assistencial_bruto) ÷ SUM(quantidade_servicos).",
    filters: PROCEDURE_FILTERS,
    notes: [
      "Separa frequência de severidade: muito volume com custo médio baixo é um problema diferente de pouco volume com custo médio alto.",
    ],
    related: ["procedure-trends.pareto"],
  },
  {
    id: "procedure-trends.monthly",
    kind: "block",
    label: "Custo mensal por procedimento",
    layer: "mart",
    sources: PROCEDURE_SOURCES,
    formula:
      "Série mensal de SUM(custo_assistencial_bruto) e SUM(quantidade_servicos) para os procedimentos do recorte.",
    filters: PROCEDURE_FILTERS,
    related: ["procedure-trends.pareto"],
  },
];

export async function procedureTrendsScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { limit: number; eventType?: string },
) {
  if (!period.usableMonths.length) return { window: [], pareto: [], series: [], growth_ranking: [] };
  const months = monthsInSql(period.usableMonths);
  const params = createSqlParams();
  const companyParam = params.add(companyKey);
  const eventFilter = options.eventType
    ? ` AND m.procedimento_key IN (
        SELECT DISTINCT coalesce(nullif(trim(codigo_procedimento_operadora), ''), 'SEM_CODIGO')
        FROM ${TABLES.gold}
        WHERE NOT flag_data_suspeita AND company_key = ${companyParam}
          AND coalesce(nullif(trim(tipo_evento), ''), 'Sem classificação') = ${params.add(options.eventType)})`
    : "";

  const windowRows = await q(
    `WITH reembolso AS (
      SELECT coalesce(nullif(trim(codigo_procedimento_operadora), ''), 'SEM_CODIGO') AS procedimento_key,
        round(sum(CASE WHEN flag_reembolso THEN custo_assistencial_bruto ELSE 0 END), 2) AS custo_reembolso
      FROM ${TABLES.gold}
      WHERE NOT flag_data_suspeita AND company_key = ${companyParam} AND month_key IN (${months})
      GROUP BY 1
    )
    SELECT m.procedimento_key,
      max(m.descricao_comercial), max(m.grupo_comercial),
      sum(m.linhas_cobranca), sum(m.quantidade_servicos), sum(m.utilizantes),
      sum(m.episodios_internacao), round(sum(m.custo_assistencial_bruto), 2),
      round(sum(m.custo_assistencial_bruto) / nullif(sum(m.quantidade_servicos), 0), 2),
      coalesce(max(r.custo_reembolso), 0),
      sum(sum(m.custo_assistencial_bruto)) OVER () AS custo_total
    FROM ${TABLES.martProcedimentoMes} m
    LEFT JOIN reembolso r ON r.procedimento_key = m.procedimento_key
    WHERE m.company_key = ${companyParam} AND m.month_key IN (${months})${eventFilter}
    GROUP BY m.procedimento_key
    ORDER BY 8 DESC, m.procedimento_key
    LIMIT 100`,
    params.list,
  );

  const totalCost = windowRows[0] ? toNum(windowRows[0][10]) : 0;
  let cumulative = 0;
  const window = windowRows.map((row, index) => {
    const grossCost = toNum(row[7]);
    cumulative += grossCost;
    return {
      entity_key: String(getCell(row[0])),
      description: String(getCell(row[1]) || "Sem descrição"),
      macrogroup: String(getCell(row[2]) || "Sem classificação"),
      billing_lines: toInt(row[3]),
      service_quantity: toNum(row[4]),
      // Soma de utilizantes mensais: pessoas podem repetir entre meses.
      monthly_utilizers_sum: toInt(row[5]),
      hospitalization_episodes: toInt(row[6]),
      gross_cost: grossCost,
      average_cost_per_service: getCell(row[8]) === null ? null : toNum(row[8]),
      reimbursement_cost: toNum(row[9]),
      reimbursement_share: grossCost ? toNum(row[9]) / grossCost : null,
      cost_share: totalCost ? grossCost / totalCost : null,
      cumulative_cost_share: totalCost ? cumulative / totalCost : null,
      position: index + 1,
    };
  });

  const topKeys = window.slice(0, options.limit).map((entry) => entry.entity_key);
  const coveredMonths = await fetchCoveredMonths(q, companyKey, period.usableMonths);
  const seriesRows = topKeys.length
    ? await q(
        `SELECT procedimento_key, month_key, sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2)
        FROM ${TABLES.martProcedimentoMes}
        WHERE company_key = ${companyParam} AND month_key IN (${months})
          AND procedimento_key IN (${params.addAll(topKeys)})
        GROUP BY procedimento_key, month_key
        ORDER BY month_key`,
        params.list,
      )
    : [];

  const seriesByKey = new Map<string, { month: string; service_quantity: number; gross_cost: number }[]>();
  for (const row of seriesRows) {
    const key = String(getCell(row[0]));
    const list = seriesByKey.get(key) ?? [];
    list.push({ month: String(getCell(row[1])), service_quantity: toNum(row[2]), gross_cost: toNum(row[3]) });
    seriesByKey.set(key, list);
  }
  const series = topKeys.map((key) => ({
    entity_key: key,
    description: window.find((entry) => entry.entity_key === key)?.description ?? key,
    // Série densa dentro da janela: mês coberto sem consumo do item = zero;
    // mês sem cobertura da empresa = null (nunca zero).
    monthly: period.usableMonths.map((month): { month: string; service_quantity: number | null; gross_cost: number | null } => {
      const found = (seriesByKey.get(key) ?? []).find((entry) => entry.month === month);
      if (found) return found;
      return coveredMonths.has(month)
        ? { month, service_quantity: 0, gross_cost: 0 }
        : { month, service_quantity: null, gross_cost: null };
    }),
  }));

  // Crescimento: dois últimos meses utilizáveis COM cobertura, por item.
  const growthMonths = period.usableMonths.filter((month) => coveredMonths.has(month));
  const growthRanking = series
    .map((entry) => {
      const covered = entry.monthly.filter((point) => growthMonths.includes(point.month));
      const last = covered.at(-1)?.gross_cost ?? null;
      const previous = covered.length > 1 ? covered.at(-2)!.gross_cost : null;
      const result = growth(last, previous);
      return {
        entity_key: entry.entity_key,
        description: entry.description,
        last_month_cost: last,
        previous_month_cost: previous,
        growth_state: result.state,
        growth_pct: result.pct === null ? null : Math.round(result.pct * 100) / 100,
      };
    })
    .sort((a, b) => (b.growth_pct ?? -Infinity) - (a.growth_pct ?? -Infinity));

  return {
    window,
    pareto: window.map((entry) => ({
      entity_key: entry.entity_key,
      description: entry.description,
      gross_cost: entry.gross_cost,
      cost_share: entry.cost_share,
      cumulative_cost_share: entry.cumulative_cost_share,
    })),
    series,
    growth_ranking: growthRanking,
  };
}
