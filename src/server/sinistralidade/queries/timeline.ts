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
  custo_por_vida_elegivel: "R$/vida-mês",
  variacao: "%",
};

import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

// Linhagem dos dois blocos que este escopo desenha. Mora aqui, ao lado do SQL,
// para que uma mudança de consulta não passe sem revisar a documentação.
export const TIMELINE_LINEAGE: LineageEntry[] = [
  {
    id: "timeline.monthly",
    kind: "block",
    label: "Evolução mensal por data de atendimento",
    layer: "mart",
    sources: [
      {
        object: TABLES.martMonth,
        role: "fato principal",
        columns: [
          "month_key",
          "custo_assistencial_bruto",
          "utilizantes",
          "familias_utilizantes",
          "quantidade_servicos",
          "linhas_cobranca",
          "vidas_elegiveis",
          "custo_por_vida_elegivel",
          "freshness",
        ],
      },
      {
        object: TABLES.martInternacaoMes,
        role: "episódios de internação do mês",
        columns: ["month_key", "episodios_internacao"],
      },
      {
        object: TABLES.monthStatus,
        role: "gate de fechamento do período",
        columns: ["company_key", "month_key", "status", "updated_at"],
      },
    ],
    formula:
      "Uma linha por mês da janela. Custo = SUM(custo_assistencial_bruto). Variação mês a mês e ano a ano calculadas sobre o custo; média móvel de 3 meses.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "A série é densa: todo mês da janela aparece. Mês sem cobertura vem com métricas null, nunca zero, e has_data = false.",
      "Mês fora dos meses aprovados aparece com included = false e sem métricas.",
      "A variação ano a ano (yoy) compara com o mesmo mês do ano anterior, derivado por aritmética de calendário sobre a espinha da janela — não passa pelo gate de fechamento. A comparação pode envolver um mês do ano anterior que não está fechado.",
    ],
    related: ["timeline.competency", "kpi.gross_cost"],
  },
  {
    id: "timeline.competency",
    kind: "block",
    label: "Custo por competência de faturamento",
    layer: "gold",
    sources: [
      {
        object: TABLES.gold,
        role: "fato assistencial",
        columns: [
          "competencia_cobranca",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "company_key",
          "flag_data_suspeita",
        ],
      },
    ],
    formula:
      "SUM(custo_assistencial_bruto) agrupado por competencia_cobranca convertida de dd/MM/yyyy para yyyy-MM.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "NOT flag_data_suspeita",
      "competências dentro da janela selecionada",
    ],
    notes: [
      "Responde 'quanto foi faturado no mês', não 'quanto foi atendido no mês'. É por isso que difere da série por data de atendimento.",
      "Mês sem faturamento na competência vem null, nunca zero.",
    ],
    related: ["timeline.monthly"],
  },
];

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
  if (!spine.length) return { months: [], competency: [], kpis: null, updatedAt: null };

  const [monthRows, episodeRows, yoyRows, competencyRows] = await Promise.all([
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
    // Série por COMPETÊNCIA DE FATURAMENTO (feedback C1): custo agrupado por
    // competencia_cobranca (dd/MM/yyyy → yyyy-MM), alinhado aos mesmos meses da
    // janela. É o "quanto foi faturado no mês", independente da data do serviço.
    q(
      `SELECT date_format(to_date(competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') AS competencia,
        round(sum(custo_assistencial_bruto), 2) AS custo,
        sum(quantidade_servicos) AS servicos,
        count(*) AS linhas
      FROM ${TABLES.gold}
      WHERE NOT flag_data_suspeita AND company_key = '${companyKey}'
        AND date_format(to_date(competencia_cobranca, 'dd/MM/yyyy'), 'yyyy-MM') IN (${monthsInSql(spine)})
      GROUP BY 1`,
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

  // Série de competência alinhada à espinha: mês sem faturamento na competência
  // fica null (nunca zero), coerente com a série de atendimento.
  const competencyByMonth = new Map(competencyRows.map((row) => [String(getCell(row[0])), row]));
  const competency = spine.map((month) => {
    const row = competencyByMonth.get(month);
    return {
      month,
      gross_cost: row ? toNum(row[1]) : null,
      service_quantity: row ? toNum(row[2]) : null,
      billing_lines: row ? toInt(row[3]) : null,
    };
  });

  return { months, competency, kpis, updatedAt: freshness || null };
}
