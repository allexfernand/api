// Escopo `procedure-trends`: rankings, Pareto, série mensal e dispersão de
// procedimentos/serviços. Linha de conta, quantidade de serviço e episódio
// são sempre colunas separadas para evitar dupla leitura.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { escape } from "../../databricks/client";
import { getCell, growth, toInt, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const PROCEDURE_UNITS = {
  custo: "R$",
  custo_medio: "R$/serviço",
  servicos: "serviços",
  linhas: "linhas de cobrança",
  utilizantes: "pessoas",
  internacoes: "episódios",
  participacao: "%",
};

export async function procedureTrendsScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { limit: number; eventType?: string },
) {
  if (!period.usableMonths.length) return { window: [], pareto: [], series: [], growth_ranking: [] };
  const months = monthsInSql(period.usableMonths);
  const eventFilter = options.eventType
    ? ` AND procedimento_key IN (
        SELECT DISTINCT coalesce(nullif(trim(codigo_procedimento_operadora), ''), 'SEM_CODIGO')
        FROM ${TABLES.gold}
        WHERE NOT flag_data_suspeita AND company_key = '${companyKey}'
          AND coalesce(nullif(trim(tipo_evento), ''), 'Sem classificação') = '${escape(options.eventType)}')`
    : "";

  const windowRows = await q(
    `SELECT procedimento_key,
      max(descricao_comercial), max(grupo_comercial),
      sum(linhas_cobranca), sum(quantidade_servicos), sum(utilizantes),
      sum(episodios_internacao), round(sum(custo_assistencial_bruto), 2),
      round(sum(custo_assistencial_bruto) / nullif(sum(quantidade_servicos), 0), 2),
      sum(sum(custo_assistencial_bruto)) OVER () AS custo_total
    FROM ${TABLES.martProcedimentoMes}
    WHERE company_key = '${companyKey}' AND month_key IN (${months})${eventFilter}
    GROUP BY procedimento_key
    ORDER BY 8 DESC, procedimento_key
    LIMIT 100`,
  );

  const totalCost = windowRows[0] ? toNum(windowRows[0][9]) : 0;
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
      cost_share: totalCost ? grossCost / totalCost : null,
      cumulative_cost_share: totalCost ? cumulative / totalCost : null,
      position: index + 1,
    };
  });

  const topKeys = window.slice(0, options.limit).map((entry) => entry.entity_key);
  const seriesRows = topKeys.length
    ? await q(
        `SELECT procedimento_key, month_key, sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2)
        FROM ${TABLES.martProcedimentoMes}
        WHERE company_key = '${companyKey}' AND month_key IN (${months})
          AND procedimento_key IN (${topKeys.map((key) => `'${escape(key)}'`).join(",")})
        GROUP BY procedimento_key, month_key
        ORDER BY month_key`,
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
    // Série densa dentro da janela: mês sem consumo do item = zero.
    monthly: period.usableMonths.map((month) => {
      const found = (seriesByKey.get(key) ?? []).find((entry) => entry.month === month);
      return found ?? { month, service_quantity: 0, gross_cost: 0 };
    }),
  }));

  // Crescimento: último mês utilizável × mês anterior utilizável, por item.
  const growthRanking = series
    .map((entry) => {
      const last = entry.monthly.at(-1)?.gross_cost ?? null;
      const previous = entry.monthly.length > 1 ? entry.monthly.at(-2)!.gross_cost : null;
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
