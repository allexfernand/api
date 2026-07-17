// Escopos 1.0.0 preservados. Nenhuma métrica muda de significado aqui;
// a evolução longitudinal vive nos escopos 1.1.0 (ver index.ts).

import type { SinistralidadeQuery } from "../../contracts/sinistralidade-v2";
import { getCell, toBool, toInt, toNum } from "./serializers";
import { TABLES, type QueryRunner } from "./query-runner";

export async function legacyScopeData(q: QueryRunner, input: SinistralidadeQuery, companyKey: string) {
  if (input.scope === "overview") {
    const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
    const rows = await q(
      `SELECT month_key, linhas_cobranca, quantidade_servicos, utilizantes, familias_utilizantes, custo_assistencial_bruto, coparticipacao, custo_liquido_aproximado, freshness, participacao_custo_mes, vidas_elegiveis, custo_por_vida_elegivel FROM ${TABLES.martMonth} WHERE company_key = '${companyKey}'${monthFilter} ORDER BY month_key`,
    );
    return rows.map((row) => ({
      month: String(getCell(row[0])),
      billing_lines: toInt(row[1]),
      service_quantity: toNum(row[2]),
      utilizers: toInt(row[3]),
      utilizing_families: toInt(row[4]),
      gross_cost: toNum(row[5]),
      copayment: toNum(row[6]),
      approximate_net_cost: toNum(row[7]),
      freshness: getCell(row[8]),
      company_cost_share: toNum(row[9]),
      eligible_lives: getCell(row[10]) == null ? null : toNum(row[10]),
      cost_per_eligible_life: getCell(row[11]) == null ? null : toNum(row[11]),
    }));
  }
  if (input.scope === "top10") {
    if (!input.month) {
      const error = new Error("month é obrigatório para Top 10.");
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
    const rows = await q(
      `SELECT entity_type, entity_key, entity_label, linhas_cobranca, quantidade_servicos, custo_assistencial_bruto, utilizantes, internacoes, evento_principal, rank_custo, rank_linhas, rank_quantidade FROM ${TABLES.martTop} WHERE company_key = '${companyKey}' AND month_key = '${input.month}' ORDER BY entity_type, rank_custo`,
    );
    return rows.map((row) => ({
      entity_type: String(getCell(row[0])),
      entity_key: String(getCell(row[1])),
      label: String(getCell(row[2])),
      billing_lines: toInt(row[3]),
      service_quantity: toNum(row[4]),
      gross_cost: toNum(row[5]),
      utilizers: toInt(row[6]),
      hospitalizations: toInt(row[7]),
      primary_event: getCell(row[8]),
      cost_rank: toInt(row[9]),
      lines_rank: toInt(row[10]),
      quantity_rank: toInt(row[11]),
    }));
  }
  if (input.scope === "bimester") {
    if (!input.bimester) {
      const error = new Error("bimester é obrigatório.");
      Object.assign(error, { statusCode: 400 });
      throw error;
    }
    const rows = await q(
      `SELECT entity_type, entity_key, custo_assistencial_bruto, linhas_cobranca, quantidade_servicos, rank_custo, rank_linhas, rank_quantidade FROM ${TABLES.martBimester} WHERE company_key = '${companyKey}' AND bimester_key = '${input.bimester}' AND least(rank_custo, rank_linhas, rank_quantidade) <= 10 ORDER BY entity_type, rank_custo`,
    );
    return rows.map((row) => ({
      entity_type: String(getCell(row[0])),
      entity_key: String(getCell(row[1])),
      gross_cost: toNum(row[2]),
      billing_lines: toInt(row[3]),
      service_quantity: toNum(row[4]),
      cost_rank: toInt(row[5]),
      lines_rank: toInt(row[6]),
      quantity_rank: toInt(row[7]),
    }));
  }
  if (input.scope === "mental-health") {
    const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
    const rows = await q(
      `SELECT month_key, saude_mental, episodios_internacao, utilizantes, custo_total, custo_medio_por_episodio, duracao_mediana_dias, duracao_p90_dias FROM ${TABLES.martMental} WHERE company_key = '${companyKey}'${monthFilter} ORDER BY month_key, saude_mental DESC`,
    );
    return rows.map((row) => ({
      month: String(getCell(row[0])),
      mental_health: toBool(row[1]),
      hospitalization_episodes: toInt(row[2]),
      utilizers: toInt(row[3]),
      total_cost: toNum(row[4]),
      average_episode_cost: toNum(row[5]),
      median_duration_days: toNum(row[6]),
      p90_duration_days: toNum(row[7]),
    }));
  }
  if (input.scope === "ps-package") {
    const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
    const rows = await q(
      `SELECT descricao_procedimento, macrogroup, count(DISTINCT episode_key), sum(linhas_cobranca), sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2) FROM ${TABLES.martPsEpisode} WHERE company_key = '${companyKey}'${monthFilter} GROUP BY 1, 2 ORDER BY 6 DESC LIMIT 50`,
    );
    return rows.map((row) => ({
      procedure: String(getCell(row[0]) || "Sem descrição"),
      macrogroup: String(getCell(row[1]) || "Sem classificação"),
      episodes: toInt(row[2]),
      billing_lines: toInt(row[3]),
      service_quantity: toNum(row[4]),
      gross_cost: toNum(row[5]),
    }));
  }
  if (input.scope === "care-coordination") {
    const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
    const rows = await q(
      `SELECT utilizou_plano, teve_coordenacao, count(*), round(sum(custo_assistencial_bruto), 2), coordination_status FROM ${TABLES.martCare} WHERE company_key = '${companyKey}'${monthFilter} GROUP BY 1, 2, 5 ORDER BY 1 DESC, 2 DESC`,
    );
    return rows.map((row) => ({
      used_plan: toBool(row[0]),
      had_care_coordination: toBool(row[1]),
      eligible_people: toInt(row[2]),
      gross_cost: toNum(row[3]),
      status: String(getCell(row[4])),
    }));
  }
  if (input.scope === "family-before-after") {
    const rows = await q(
      `SELECT phase, count(DISTINCT family_key), sum(billing_lines), sum(service_quantity), round(sum(gross_cost), 2), max_by(event_type, gross_cost) FROM ${TABLES.martFamily} WHERE company_key = '${companyKey}' GROUP BY phase ORDER BY phase`,
    );
    return rows.map((row) => ({
      phase: String(getCell(row[0])),
      families: toInt(row[1]),
      billing_lines: toInt(row[2]),
      service_quantity: toNum(row[3]),
      gross_cost: toNum(row[4]),
      primary_event: String(getCell(row[5]) || "Sem classificação"),
    }));
  }
  // year-over-year
  const comparisonYear = input.year ?? new Date().getUTCFullYear();
  const rows = await q(
    `SELECT comparison_year, sinistros, itens, custo_assistencial_bruto, observed_months, closed_months, publication_status FROM ${TABLES.martHalfYear} WHERE company_key = '${companyKey}' AND comparison_year IN (${comparisonYear - 1}, ${comparisonYear}) ORDER BY comparison_year`,
  );
  return rows.map((row) => ({
    year: toInt(row[0]),
    claims: toInt(row[1]),
    items: toNum(row[2]),
    gross_cost: toNum(row[3]),
    observed_months: toInt(row[4]),
    closed_months: toInt(row[5]),
    publication_status: String(getCell(row[6])),
  }));
}
