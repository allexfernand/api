// Escopo `timeline`: KPIs executivos e evolução mensal.
// A série é densa dentro da janela: todo mês do período aparece na resposta.
// Mês sem cobertura tem métricas null (nunca zero) e `has_data = false`.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { getCell, growth, movingAverage, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const TIMELINE_UNITS = {
  custo: "R$",
  utilizantes: "pessoas",
  servicos: "serviços",
  internacoes: "episódios",
  familias: "famílias",
  custo_por_utilizante: "R$/pessoa",
  custo_por_vida_elegivel: "R$/vida",
  variacao: "%",
};

export type TimelineMonth = {
  month: string;
  status: string;
  has_data: boolean;
  included: boolean;
  gross_cost: number | null;
  utilizers: number | null;
  service_quantity: number | null;
  billing_lines: number | null;
  hospitalization_episodes: number | null;
  utilizing_families: number | null;
  cost_per_utilizer: number | null;
  eligible_lives: number | null;
  cost_per_eligible_life: number | null;
  mom: { state: string; pct: number | null };
  yoy: { state: string; pct: number | null };
  moving_average_cost: number | null;
};

export async function timelineScope(q: QueryRunner, companyKey: string, period: ResolvedPeriod) {
  const spine = period.effective.months.map((entry) => entry.month);
  if (!spine.length) return { months: [], kpis: null, updatedAt: null };

  const [monthRows, episodeRows, yoyRows] = await Promise.all([
    q(
      `SELECT month_key, linhas_cobranca, quantidade_servicos, utilizantes, familias_utilizantes,
        custo_assistencial_bruto, vidas_elegiveis, custo_por_vida_elegivel, freshness
      FROM ${TABLES.martMonth}
      WHERE company_key = '${companyKey}' AND month_key IN (${monthsInSql(spine)})
      ORDER BY month_key`,
    ),
    q(
      `SELECT month_key, sum(episodios_internacao)
      FROM ${TABLES.martInternacaoMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${monthsInSql(spine)})
      GROUP BY month_key`,
    ),
    // Ano contra ano: mesmos meses do ano anterior, apenas para variação.
    q(
      `SELECT month_key, custo_assistencial_bruto
      FROM ${TABLES.martMonth}
      WHERE company_key = '${companyKey}'
        AND month_key IN (${monthsInSql(spine.map((month) => `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`))})`,
    ),
  ]);

  const byMonth = new Map(monthRows.map((row) => [String(getCell(row[0])), row]));
  const episodesByMonth = new Map(episodeRows.map((row) => [String(getCell(row[0])), toInt(row[1])]));
  const yoyCostByMonth = new Map(yoyRows.map((row) => [String(getCell(row[0])), toNum(row[1])]));
  const usable = new Set(period.usableMonths);

  const base = period.effective.months.map((entry) => {
    const row = byMonth.get(entry.month);
    const included = usable.has(entry.month) && Boolean(row);
    const grossCost = row && included ? toNum(row[5]) : null;
    const utilizers = row && included ? toInt(row[3]) : null;
    return {
      month: entry.month,
      status: entry.status,
      has_data: Boolean(row),
      included,
      gross_cost: grossCost,
      utilizers,
      service_quantity: row && included ? toNum(row[2]) : null,
      billing_lines: row && included ? toInt(row[1]) : null,
      hospitalization_episodes: included ? (episodesByMonth.get(entry.month) ?? 0) : null,
      utilizing_families: row && included ? toInt(row[4]) : null,
      cost_per_utilizer: grossCost !== null && utilizers ? Math.round((grossCost / utilizers) * 100) / 100 : null,
      eligible_lives: row && included ? toNullableNum(row[6]) : null,
      cost_per_eligible_life: row && included ? toNullableNum(row[7]) : null,
    };
  });

  const costs = base.map((entry) => entry.gross_cost);
  const mm3 = movingAverage(costs, 3);
  const months: TimelineMonth[] = base.map((entry, index) => ({
    ...entry,
    mom: growth(entry.gross_cost, index > 0 ? base[index - 1].gross_cost : null),
    yoy: growth(entry.gross_cost, yoyCostByMonth.get(`${Number(entry.month.slice(0, 4)) - 1}${entry.month.slice(4)}`) ?? null),
    moving_average_cost: mm3[index] === null ? null : Math.round((mm3[index] as number) * 100) / 100,
  }));

  const includedMonths = months.filter((entry) => entry.included && entry.has_data);
  const totalCost = includedMonths.reduce((total, entry) => total + (entry.gross_cost ?? 0), 0);
  const totalServices = includedMonths.reduce((total, entry) => total + (entry.service_quantity ?? 0), 0);
  const totalEpisodes = includedMonths.reduce((total, entry) => total + (entry.hospitalization_episodes ?? 0), 0);
  const eligibleValid = includedMonths.length > 0 && includedMonths.every((entry) => entry.eligible_lives !== null);

  const utilizersWindow = includedMonths.length
    ? await q(
        `SELECT count(DISTINCT person_key), count(DISTINCT family_key)
        FROM ${TABLES.martPessoaMes}
        WHERE company_key = '${companyKey}' AND month_key IN (${monthsInSql(includedMonths.map((entry) => entry.month))})`,
      )
    : [];
  const windowUtilizers = utilizersWindow[0] ? toInt(utilizersWindow[0][0]) : 0;
  const windowFamilies = utilizersWindow[0] ? toInt(utilizersWindow[0][1]) : 0;

  const kpis = includedMonths.length
    ? {
        months_included: includedMonths.length,
        gross_cost: Math.round(totalCost * 100) / 100,
        utilizers: windowUtilizers,
        service_quantity: totalServices,
        hospitalization_episodes: totalEpisodes,
        utilizing_families: windowFamilies,
        cost_per_utilizer: windowUtilizers ? Math.round((totalCost / windowUtilizers) * 100) / 100 : null,
        services_per_utilizer: windowUtilizers ? Math.round((totalServices / windowUtilizers) * 100) / 100 : null,
        // Denominadores só quando todos os meses incluídos têm snapshot contemporâneo.
        cost_per_eligible_life: eligibleValid
          ? Math.round((totalCost / includedMonths.reduce((total, entry) => total + (entry.eligible_lives ?? 0), 0)) * 100) / 100
          : null,
        hospitalizations_per_thousand_lives: eligibleValid
          ? Math.round((totalEpisodes / includedMonths.reduce((total, entry) => total + (entry.eligible_lives ?? 0), 0)) * 1000 * 100) / 100
          : null,
        normalized_state: eligibleValid ? "valid" : "not_comparable",
      }
    : null;

  const freshness = monthRows
    .map((row) => String(getCell(row[8]) || ""))
    .filter(Boolean)
    .sort()
    .at(-1);

  return { months, kpis, updatedAt: freshness || null };
}
