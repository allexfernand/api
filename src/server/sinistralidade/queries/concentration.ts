// Escopos `concentration` e `company-benchmark`.
// O benchmark é derivado do mart mensal + elegibilidade, sem mart próprio,
// e nunca ranqueia empresas por custo por vida com denominador inválido.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { companyScopeSql } from "../../auth/company-scope";
import type { AuthIdentity } from "../permissions";
import { getCell, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const CONCENTRATION_UNITS = {
  participacao: "fração (0–1)",
  pessoas: "pessoas",
  custo: "R$",
};

export async function concentrationScope(q: QueryRunner, companyKey: string, period: ResolvedPeriod) {
  if (!period.usableMonths.length) return { monthly: [] };
  const rows = await q(
    `SELECT month_key, pessoas_utilizantes, custo_total, participacao_top1, participacao_top5,
      participacao_top10, participacao_top10pct, pessoas_para_50pct, pessoas_para_80pct,
      top10_recorrentes_mes_anterior
    FROM ${TABLES.martConcentracaoMes}
    WHERE company_key = '${companyKey}' AND month_key IN (${monthsInSql(period.usableMonths)})
    ORDER BY month_key`,
  );
  return {
    monthly: rows.map((row) => ({
      month: String(getCell(row[0])),
      utilizers: toInt(row[1]),
      total_cost: toNum(row[2]),
      top1_share: toNullableNum(row[3]),
      top5_share: toNullableNum(row[4]),
      top10_share: toNullableNum(row[5]),
      top10pct_share: toNullableNum(row[6]),
      people_to_50pct: toNullableNum(row[7]),
      people_to_80pct: toNullableNum(row[8]),
      top10_recurrent_from_previous_month: toInt(row[9]),
    })),
  };
}

export const BENCHMARK_UNITS = {
  custo: "R$",
  custo_por_utilizante: "R$/pessoa",
  custo_por_vida: "R$/vida-mês",
  servicos_por_utilizante: "serviços/pessoa",
  participacao: "fração (0–1)",
};

export async function companyBenchmarkScope(q: QueryRunner, auth: AuthIdentity, period: ResolvedPeriod) {
  if (!period.usableMonths.length) return { companies: [] };
  const months = monthsInSql(period.usableMonths);
  const rows = await q(
    `SELECT m.company_key, max(d.nome_empresa_canonico),
      round(sum(m.custo_assistencial_bruto), 2),
      sum(m.utilizantes) AS utilizantes_mes,
      sum(m.quantidade_servicos),
      sum(m.linhas_cobranca),
      count(DISTINCT m.month_key) AS meses,
      sum(CASE WHEN m.vidas_elegiveis IS NULL THEN 1 ELSE 0 END) AS meses_sem_denominador,
      sum(m.vidas_elegiveis)
    FROM ${TABLES.martMonth} m
    LEFT JOIN ${TABLES.dimCompany} d ON m.company_key = d.company_key
    WHERE m.month_key IN (${months})${companyScopeSql(auth, "m.company_key")}
    GROUP BY m.company_key
    ORDER BY 3 DESC, m.company_key`,
  );
  const totalCost = rows.reduce((total, row) => total + toNum(row[2]), 0);
  return {
    companies: rows.map((row) => {
      const grossCost = toNum(row[2]);
      const monthlyUtilizersSum = toInt(row[3]);
      const services = toNum(row[4]);
      const monthsWithoutDenominator = toInt(row[7]);
      const eligibleLives = toNullableNum(row[8]);
      const denominatorValid = monthsWithoutDenominator === 0 && eligibleLives !== null && eligibleLives > 0;
      return {
        company_key: String(getCell(row[0])),
        name: String(getCell(row[1]) || "Empresa sem nome"),
        gross_cost: grossCost,
        operator_cost_share: totalCost ? grossCost / totalCost : null,
        monthly_utilizers_sum: monthlyUtilizersSum,
        service_quantity: services,
        billing_lines: toInt(row[5]),
        months_observed: toInt(row[6]),
        cost_per_utilizer: monthlyUtilizersSum ? Math.round((grossCost / monthlyUtilizersSum) * 100) / 100 : null,
        services_per_utilizer: monthlyUtilizersSum ? Math.round((services / monthlyUtilizersSum) * 100) / 100 : null,
        // Normalizados por vida: só com denominador contemporâneo em TODOS os meses.
        cost_per_eligible_life: denominatorValid ? Math.round((grossCost / (eligibleLives as number)) * 100) / 100 : null,
        normalized_state: denominatorValid ? "valid" : "not_comparable",
      };
    }),
  };
}
