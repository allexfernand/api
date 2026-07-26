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

import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const CONCENTRATION_LINEAGE: LineageEntry[] = [
  {
    id: "concentration.monthly",
    kind: "block",
    label: "Concentração mensal do custo em beneficiários",
    layer: "mart",
    sources: [
      {
        object: TABLES.martConcentracaoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "pessoas_utilizantes",
          "custo_total",
          "participacao_top1",
          "participacao_top5",
          "participacao_top10",
          "participacao_top10pct",
          "pessoas_para_50pct",
          "pessoas_para_80pct",
          "top10_recorrentes_mes_anterior",
        ],
      },
    ],
    formula:
      "Participação acumulada do custo detida pelos maiores utilizantes de cada mês, e quantas pessoas são necessárias para somar 50% e 80% do custo.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "Só agregados. Nenhuma identificação individual sai deste bloco.",
      "top10_recorrentes_mes_anterior mede persistência: quantos do Top 10 do mês já estavam no Top 10 do mês anterior.",
    ],
  },
];

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

export const BENCHMARK_LINEAGE: LineageEntry[] = [
  {
    id: "company-benchmark.table",
    kind: "block",
    label: "Comparação entre empresas",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato principal, agregado por empresa",
        columns: [
          "company_key",
          "month_key",
          "custo_assistencial_bruto",
          "utilizantes",
          "quantidade_servicos",
          "linhas_cobranca",
          "vidas_elegiveis",
        ],
      },
      {
        object: TABLES.dimCompany,
        role: "nome canônico da empresa",
        columns: ["company_key", "nome_empresa_canonico"],
      },
    ],
    formula:
      "Uma linha por empresa: custo somado na janela, participação sobre o total do escopo, custo por utilizante e serviços por utilizante.",
    filters: [
      "todas as empresas do escopo do usuário — este bloco ignora o filtro de empresa da tela",
      "meses aprovados pelo gate agregado: closed só quando toda empresa com registro no mês está fechada",
    ],
    notes: [
      "Não existe mart próprio de benchmark: ele é derivado do mart mensal.",
      "Custo por vida elegível só aparece quando todos os meses da janela têm denominador; caso contrário o estado é not_comparable e o campo fica null.",
      "O somatório de utilizantes é por mês: a mesma pessoa em dois meses conta duas vezes. Não é população distinta.",
    ],
    related: ["timeline.monthly"],
  },
];

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
