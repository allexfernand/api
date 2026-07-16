import { getDashboardAuth, requireBasicAuth } from "../../../lib/basic-auth";
import { getCell, resolveWarehouseId, runQuery, toInt, toNum } from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";
import { sinistralidadeQuerySchema } from "../../contracts/sinistralidade-v2";
import { assertCompanyAccess, companyScopeSql } from "../auth/company-scope";

type ApiRequest = { method?: string; query: Record<string, unknown>; headers?: Record<string, string | string[] | undefined> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const DIM_COMPANY = "hive_metastore.sanus_prod.dim_empresa_gold_v2";
const MART_MONTH = "hive_metastore.sanus_prod.mart_sinistro_empresa_mes_v2";
const MART_TOP = "hive_metastore.sanus_prod.mart_top10_mes_v2";
const MART_BIMESTER = "hive_metastore.sanus_prod.mart_top10_bimestre_v2";
const MART_MENTAL = "hive_metastore.sanus_prod.mart_saude_mental_internacao_v2";
const MART_PS = "hive_metastore.sanus_prod.mart_ps_episodio_item_v2";
const MART_CARE = "hive_metastore.sanus_prod.mart_fatura_coordenacao_v2";
const MART_FAMILY = "hive_metastore.sanus_prod.mart_familia_antes_depois_v2";
const MART_HALF_YEAR = "hive_metastore.sanus_prod.mart_comparativo_semestral_v2";
const MONTH_STATUS = "hive_metastore.sanus_prod.sinistralidade_month_status_v2";

function first(value: unknown) {
  return Array.isArray(value) ? value[0] : value;
}

function queryRecord(query: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(first(value) ?? "")])) as Record<string, string>;
}

function toBool(value: unknown) {
  const normalized = String(getCell(value as never) ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function metadata(companyKey?: string, status: "closed" | "partial" | "unknown" = "unknown", warning: string | null = null) {
  return {
    contract_version: "1.0.0",
    generated_at: new Date().toISOString(),
    ...(companyKey ? { company_key: companyKey } : {}),
    period_status: status,
    warning,
  };
}

async function monthStatus(q: (sql: string) => Promise<unknown[][]>, companyKey: string, month?: string) {
  if (!month) return { status: "unknown" as const, warning: "Selecione um mês para validar o fechamento." };
  const rows = await q(`SELECT status FROM ${MONTH_STATUS} WHERE company_key = '${companyKey}' AND month_key = '${month}' ORDER BY updated_at DESC LIMIT 1`);
  const value = String(getCell(rows[0]?.[0] as never) || "unknown").toLowerCase();
  if (value === "closed") return { status: "closed" as const, warning: null };
  if (value === "partial") return { status: "partial" as const, warning: "Período parcial: não use para comparações fechadas." };
  return { status: "unknown" as const, warning: "O período ainda não possui gate de fechamento aprovado." };
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  const auth = getDashboardAuth(req);
  if (!auth) return;

  const parsed = sinistralidadeQuerySchema.safeParse(queryRecord(req.query));
  if (!parsed.success) return res.status(400).json({ error: "Parâmetros inválidos.", details: parsed.error.flatten() });

  try {
    const warehouseId = await resolveWarehouseId();
    const q = (sql: string) => runQuery(warehouseId, sql) as Promise<unknown[][]>;
    const input = parsed.data;

    if (input.scope === "metadata") {
      const rows = await q(`SELECT company_key, operadora, codigo_empresa, nome_empresa_canonico, primeira_data_observada, ultima_data_observada, linhas_observadas FROM ${DIM_COMPANY} WHERE 1 = 1${companyScopeSql(auth)} ORDER BY nome_empresa_canonico`);
      setStableCache(res);
      return res.status(200).json({
        source: metadata(),
        companies: rows.map((row) => ({
          company_key: String(getCell(row[0] as never)),
          operator: String(getCell(row[1] as never) || "—"),
          source_company_id: String(getCell(row[2] as never) || ""),
          name: String(getCell(row[3] as never) || "Empresa sem nome"),
          first_observed_date: getCell(row[4] as never),
          last_observed_date: getCell(row[5] as never),
          observed_rows: toInt(row[6] as never),
        })),
      });
    }

    if (!input.company_key) return res.status(400).json({ error: "company_key é obrigatório para este escopo." });
    const companyKey = assertCompanyAccess(auth, input.company_key);
    const period = await monthStatus(q, companyKey, input.month);
    if (period.status !== "closed" && input.include_partial !== "true" && ["overview", "top10", "mental-health", "ps-package", "care-coordination"].includes(input.scope)) {
      return res.status(409).json({ error: period.warning, source: metadata(companyKey, period.status, period.warning) });
    }

    let data: unknown;
    if (input.scope === "overview") {
      const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
      const rows = await q(`SELECT month_key, linhas_cobranca, quantidade_servicos, utilizantes, familias_utilizantes, custo_assistencial_bruto, coparticipacao, custo_liquido_aproximado, freshness, participacao_custo_mes, vidas_elegiveis, custo_por_vida_elegivel FROM ${MART_MONTH} WHERE company_key = '${companyKey}'${monthFilter} ORDER BY month_key`);
      data = rows.map((row) => ({ month: String(getCell(row[0] as never)), billing_lines: toInt(row[1] as never), service_quantity: toNum(row[2] as never), utilizers: toInt(row[3] as never), utilizing_families: toInt(row[4] as never), gross_cost: toNum(row[5] as never), copayment: toNum(row[6] as never), approximate_net_cost: toNum(row[7] as never), freshness: getCell(row[8] as never), company_cost_share: toNum(row[9] as never), eligible_lives: getCell(row[10] as never) == null ? null : toNum(row[10] as never), cost_per_eligible_life: getCell(row[11] as never) == null ? null : toNum(row[11] as never) }));
    } else if (input.scope === "top10") {
      if (!input.month) return res.status(400).json({ error: "month é obrigatório para Top 10." });
      const rows = await q(`SELECT entity_type, entity_key, entity_label, linhas_cobranca, quantidade_servicos, custo_assistencial_bruto, utilizantes, internacoes, evento_principal, rank_custo, rank_linhas, rank_quantidade FROM ${MART_TOP} WHERE company_key = '${companyKey}' AND month_key = '${input.month}' ORDER BY entity_type, rank_custo`);
      data = rows.map((row) => ({ entity_type: String(getCell(row[0] as never)), entity_key: String(getCell(row[1] as never)), label: String(getCell(row[2] as never)), billing_lines: toInt(row[3] as never), service_quantity: toNum(row[4] as never), gross_cost: toNum(row[5] as never), utilizers: toInt(row[6] as never), hospitalizations: toInt(row[7] as never), primary_event: getCell(row[8] as never), cost_rank: toInt(row[9] as never), lines_rank: toInt(row[10] as never), quantity_rank: toInt(row[11] as never) }));
    } else if (input.scope === "bimester") {
      if (!input.bimester) return res.status(400).json({ error: "bimester é obrigatório." });
      const rows = await q(`SELECT entity_type, entity_key, custo_assistencial_bruto, linhas_cobranca, quantidade_servicos, rank_custo, rank_linhas, rank_quantidade FROM ${MART_BIMESTER} WHERE company_key = '${companyKey}' AND bimester_key = '${input.bimester}' AND least(rank_custo, rank_linhas, rank_quantidade) <= 10 ORDER BY entity_type, rank_custo`);
      data = rows.map((row) => ({ entity_type: String(getCell(row[0] as never)), entity_key: String(getCell(row[1] as never)), gross_cost: toNum(row[2] as never), billing_lines: toInt(row[3] as never), service_quantity: toNum(row[4] as never), cost_rank: toInt(row[5] as never), lines_rank: toInt(row[6] as never), quantity_rank: toInt(row[7] as never) }));
    } else if (input.scope === "mental-health") {
      const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
      const rows = await q(`SELECT month_key, saude_mental, episodios_internacao, utilizantes, custo_total, custo_medio_por_episodio, duracao_mediana_dias, duracao_p90_dias FROM ${MART_MENTAL} WHERE company_key = '${companyKey}'${monthFilter} ORDER BY month_key, saude_mental DESC`);
      data = rows.map((row) => ({ month: String(getCell(row[0] as never)), mental_health: toBool(row[1]), hospitalization_episodes: toInt(row[2] as never), utilizers: toInt(row[3] as never), total_cost: toNum(row[4] as never), average_episode_cost: toNum(row[5] as never), median_duration_days: toNum(row[6] as never), p90_duration_days: toNum(row[7] as never) }));
    } else if (input.scope === "ps-package") {
      const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
      const rows = await q(`SELECT descricao_procedimento, macrogroup, count(DISTINCT episode_key), sum(linhas_cobranca), sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2) FROM ${MART_PS} WHERE company_key = '${companyKey}'${monthFilter} GROUP BY 1, 2 ORDER BY 6 DESC LIMIT 50`);
      data = rows.map((row) => ({ procedure: String(getCell(row[0] as never) || "Sem descrição"), macrogroup: String(getCell(row[1] as never) || "Sem classificação"), episodes: toInt(row[2] as never), billing_lines: toInt(row[3] as never), service_quantity: toNum(row[4] as never), gross_cost: toNum(row[5] as never) }));
    } else if (input.scope === "care-coordination") {
      const monthFilter = input.month ? ` AND month_key = '${input.month}'` : "";
      const rows = await q(`SELECT utilizou_plano, teve_coordenacao, count(*), round(sum(custo_assistencial_bruto), 2), coordination_status FROM ${MART_CARE} WHERE company_key = '${companyKey}'${monthFilter} GROUP BY 1, 2, 5 ORDER BY 1 DESC, 2 DESC`);
      data = rows.map((row) => ({ used_plan: toBool(row[0]), had_care_coordination: toBool(row[1]), eligible_people: toInt(row[2] as never), gross_cost: toNum(row[3] as never), status: String(getCell(row[4] as never)) }));
    } else if (input.scope === "family-before-after") {
      const rows = await q(`SELECT phase, count(DISTINCT family_key), sum(billing_lines), sum(service_quantity), round(sum(gross_cost), 2), max_by(event_type, gross_cost) FROM ${MART_FAMILY} WHERE company_key = '${companyKey}' GROUP BY phase ORDER BY phase`);
      data = rows.map((row) => ({ phase: String(getCell(row[0] as never)), families: toInt(row[1] as never), billing_lines: toInt(row[2] as never), service_quantity: toNum(row[3] as never), gross_cost: toNum(row[4] as never), primary_event: String(getCell(row[5] as never) || "Sem classificação") }));
    } else {
      const comparisonYear = input.year ?? 2026;
      const rows = await q(`SELECT comparison_year, sinistros, itens, custo_assistencial_bruto, observed_months, closed_months, publication_status FROM ${MART_HALF_YEAR} WHERE company_key = '${companyKey}' AND comparison_year IN (${comparisonYear - 1}, ${comparisonYear}) ORDER BY comparison_year`);
      data = rows.map((row) => ({ year: toInt(row[0] as never), claims: toInt(row[1] as never), items: toNum(row[2] as never), gross_cost: toNum(row[3] as never), observed_months: toInt(row[4] as never), closed_months: toInt(row[5] as never), publication_status: String(getCell(row[6] as never)) }));
    }

    setStableCache(res);
    return res.status(200).json({ source: metadata(companyKey, period.status, period.warning), data });
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode) || 500;
    return res.status(status).json({ error: error instanceof Error ? error.message : "Falha ao consultar sinistralidade v2." });
  }
}
