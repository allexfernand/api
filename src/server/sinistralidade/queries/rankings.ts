// Escopos `top-users-window` e `user-detail`.
// Nível 2 (ranking mascarado): código opaco, demografia permitida, totais.
// Nível 3 (detalhe clínico): série mensal, procedimentos, prestadores,
// eventos e internações — somente com permissão própria e auditoria.
// Nenhum identificador direto sai daqui.

import type { RankingBy } from "../../../contracts/sinistralidade-v2";
import type { ResolvedPeriod } from "../period-gate";
import { monthSpine, monthsInSql } from "../period-gate";
import { fetchCoveredMonths, getCell, maskedBeneficiaryLabel, toInt, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const TOP_USERS_UNITS = {
  custo: "R$",
  servicos: "serviços",
  internacoes: "episódios",
  participacao: "fração (0–1)",
  recorrencia: "meses com uso",
};

export const TOP_USERS_LINEAGE: LineageEntry[] = [
  {
    id: "top-users-window.table",
    kind: "block",
    label: "Maiores utilizantes da janela",
    layer: "mart",
    sources: [
      {
        object: TABLES.martPessoaMes,
        role: "fato principal",
        columns: [
          "person_key",
          "month_key",
          "faixa_etaria",
          "parentesco",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "linhas_cobranca",
          "episodios_internacao",
        ],
      },
    ],
    formula:
      "Pessoas ordenadas pelo critério escolhido (custo, serviços, internações ou crescimento) somado na janela. A posição na janela anterior vem da mesma consulta deslocada.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
      "exige permissão de ranking individual",
    ],
    notes: [
      "A identidade é o person_key opaco: nome e CPF nunca saem da camada controlada.",
      "Todo acesso a este bloco é auditado no servidor.",
    ],
    related: ["user-detail", "concentration.monthly"],
  },
];

const RANKING_COLUMN: Record<Exclude<RankingBy, "growth">, string> = {
  cost: "custo_assistencial_bruto",
  services: "quantidade_servicos",
  hospitalizations: "episodios_internacao",
};

export async function topUsersWindowScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { rankingBy: RankingBy; limit: number },
) {
  if (!period.usableMonths.length) return { rows: [], window_total_cost: 0 };
  if (options.rankingBy === "growth") {
    const error = new Error("ranking_by=growth não é suportado para beneficiários; use procedimentos.");
    Object.assign(error, { statusCode: 400 });
    throw error;
  }
  const orderColumn = RANKING_COLUMN[options.rankingBy];
  const months = monthsInSql(period.usableMonths);

  const aggregated = await q(
    `WITH window_person AS (
      SELECT person_key,
        max(faixa_etaria) AS faixa_etaria,
        max(parentesco) AS parentesco,
        sum(linhas_cobranca) AS linhas_cobranca,
        sum(quantidade_servicos) AS quantidade_servicos,
        sum(custo_assistencial_bruto) AS custo_assistencial_bruto,
        sum(episodios_internacao) AS episodios_internacao,
        count(DISTINCT month_key) AS meses_com_uso,
        max_by(evento_principal, custo_assistencial_bruto) AS evento_principal
      FROM ${TABLES.martPessoaMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      GROUP BY person_key
    )
    SELECT person_key, faixa_etaria, parentesco, linhas_cobranca, quantidade_servicos,
      custo_assistencial_bruto, episodios_internacao, meses_com_uso, evento_principal,
      sum(custo_assistencial_bruto) OVER () AS custo_total_janela,
      row_number() OVER (ORDER BY ${orderColumn} DESC, person_key) AS posicao
    FROM window_person
    QUALIFY posicao <= ${options.limit}
    ORDER BY posicao`,
  );
  if (!aggregated.length) return { rows: [], window_total_cost: 0 };

  const personKeys = aggregated.map((row) => String(getCell(row[0])));
  const windowTotalCost = toNum(aggregated[0][9]);

  // Janela imediatamente anterior (mesmo tamanho) para variação de posição.
  const windowMonths = period.requested.windowMonths ?? period.usableMonths.length;
  const firstMonth = period.usableMonths[0];
  const previousSpine = monthSpine(firstMonth, windowMonths + 1).slice(0, windowMonths);
  const [coveredMonths, previousRows, sparkRows] = await Promise.all([
    fetchCoveredMonths(q, companyKey, period.usableMonths),
    q(
      `SELECT person_key, row_number() OVER (ORDER BY sum(${orderColumn}) DESC, person_key) AS posicao
      FROM ${TABLES.martPessoaMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${monthsInSql(previousSpine)})
      GROUP BY person_key`,
    ),
    q(
      `SELECT person_key, month_key, custo_assistencial_bruto, quantidade_servicos, episodios_internacao
      FROM ${TABLES.martPessoaMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
        AND person_key IN (${personKeys.map((key) => `'${key}'`).join(",")})
      ORDER BY month_key`,
    ),
  ]);

  const previousRank = new Map(previousRows.map((row) => [String(getCell(row[0])), toInt(row[1])]));
  const sparkByPerson = new Map<string, { month: string; gross_cost: number; service_quantity: number; hospitalization_episodes: number }[]>();
  for (const row of sparkRows) {
    const key = String(getCell(row[0]));
    const list = sparkByPerson.get(key) ?? [];
    list.push({
      month: String(getCell(row[1])),
      gross_cost: toNum(row[2]),
      service_quantity: toNum(row[3]),
      hospitalization_episodes: toInt(row[4]),
    });
    sparkByPerson.set(key, list);
  }

  const rows = aggregated.map((row) => {
    const personKey = String(getCell(row[0]));
    const position = toInt(row[10]);
    const previous = previousRank.get(personKey) ?? null;
    const grossCost = toNum(row[5]);
    const spark = sparkByPerson.get(personKey) ?? [];
    // Série densa: mês coberto sem consumo recebe zero (entidade presente na
    // janela); mês sem cobertura da empresa permanece null (nunca zero).
    const monthly = period.usableMonths.map(
      (month): { month: string; gross_cost: number | null; service_quantity: number | null; hospitalization_episodes: number | null } => {
        const found = spark.find((entry) => entry.month === month);
        if (found) return found;
        return coveredMonths.has(month)
          ? { month, gross_cost: 0, service_quantity: 0, hospitalization_episodes: 0 }
          : { month, gross_cost: null, service_quantity: null, hospitalization_episodes: null };
      },
    );
    return {
      entity_key: personKey,
      label: maskedBeneficiaryLabel(personKey),
      position,
      previous_position: previous,
      position_delta: previous === null ? null : previous - position,
      is_new_entrant: previous === null,
      age_group: String(getCell(row[1]) || "") || null,
      relationship: String(getCell(row[2]) || "") || null,
      billing_lines: toInt(row[3]),
      service_quantity: toNum(row[4]),
      gross_cost: grossCost,
      hospitalization_episodes: toInt(row[6]),
      months_with_usage: toInt(row[7]),
      recurrence: period.usableMonths.length ? toInt(row[7]) / period.usableMonths.length : null,
      primary_event: String(getCell(row[8]) || "") || null,
      cost_share: windowTotalCost ? grossCost / windowTotalCost : null,
      monthly,
    };
  });

  return { rows, window_total_cost: windowTotalCost };
}

export const USER_DETAIL_UNITS = {
  custo: "R$",
  servicos: "serviços",
  internacoes: "episódios",
  duracao: "dias",
};

export const USER_DETAIL_LINEAGE: LineageEntry[] = [
  {
    id: "user-detail",
    kind: "block",
    label: "Detalhe individual do beneficiário",
    layer: "gold",
    sources: [
      {
        object: TABLES.martPessoaMes,
        role: "série mensal da pessoa",
        columns: [
          "person_key",
          "month_key",
          "custo_assistencial_bruto",
          "quantidade_servicos",
          "linhas_cobranca",
        ],
      },
      {
        object: TABLES.gold,
        role: "composição por evento, procedimento, prestador e internação",
        columns: [
          "person_key",
          "month_key",
          "tipo_evento",
          "descricao_procedimento",
          "prestador",
          "flag_internacao",
          "flag_data_suspeita",
        ],
      },
    ],
    formula:
      "Recorte da janela para uma única pessoa: série mensal, composição por evento, dez principais procedimentos, dez principais prestadores e internações do período.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "NOT flag_data_suspeita",
      "exige permissão de detalhe individual",
    ],
    notes: [
      "Este bloco não tem botão de linhagem próprio: ele vive dentro da gaveta do beneficiário. Chegue aqui pelo bloco de maiores utilizantes.",
      "Nenhum CID é exposto: a exposição de diagnóstico aguarda aprovação clínica.",
      "A resposta é servida com Cache-Control: no-store e todo acesso é auditado, inclusive tentativa sem resultado.",
    ],
    related: ["top-users-window.table"],
  },
];

export async function userDetailScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  entityKey: string,
) {
  if (!period.usableMonths.length) return null;
  const months = monthsInSql(period.usableMonths);
  const personFilter = `company_key = '${companyKey}' AND person_key = '${entityKey}'`;

  const [monthlyRows, eventRows, procedureRows, providerRows, hospitalizationRows, rankRows] = await Promise.all([
    q(
      `SELECT month_key, linhas_cobranca, quantidade_servicos, custo_assistencial_bruto,
        episodios_internacao, evento_principal, faixa_etaria, parentesco
      FROM ${TABLES.martPessoaMes}
      WHERE ${personFilter} AND month_key IN (${months})
      ORDER BY month_key`,
    ),
    q(
      `SELECT coalesce(nullif(trim(tipo_evento), ''), 'Sem classificação'),
        count(*), sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2)
      FROM ${TABLES.gold}
      WHERE NOT flag_data_suspeita AND ${personFilter} AND month_key IN (${months})
      GROUP BY 1 ORDER BY 4 DESC, 1`,
    ),
    q(
      `SELECT coalesce(nullif(trim(descricao_procedimento), ''), 'Sem descrição'),
        coalesce(nullif(trim(macrogroup), ''), 'Sem classificação'),
        sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2)
      FROM ${TABLES.gold}
      WHERE NOT flag_data_suspeita AND ${personFilter} AND month_key IN (${months})
      GROUP BY 1, 2 ORDER BY 4 DESC, 1 LIMIT 10`,
    ),
    q(
      `SELECT coalesce(nullif(trim(prestador), ''), 'Prestador não informado'),
        count(*), round(sum(custo_assistencial_bruto), 2)
      FROM ${TABLES.gold}
      WHERE NOT flag_data_suspeita AND ${personFilter} AND month_key IN (${months})
      GROUP BY 1 ORDER BY 3 DESC, 1 LIMIT 10`,
    ),
    q(
      // Uma linha por ADMISSÃO (hash sem a data — o episode_key da Gold é
      // grão atendimento-dia): acomodação nativa dominante por custo, mês inicial.
      `SELECT min(month_key),
        max_by(coalesce(nullif(trim(acomodacao_internacao), ''), 'Outras diárias'),
          struct(custo_assistencial_bruto, coalesce(nullif(trim(acomodacao_internacao), ''), 'Outras diárias'))),
        max(duracao_internacao_dias), round(sum(custo_assistencial_bruto), 2),
        max(CASE WHEN coalesce(flag_saude_mental, false) THEN 1 ELSE 0 END)
      FROM ${TABLES.gold}
      WHERE NOT flag_data_suspeita AND ${personFilter} AND flag_internacao AND month_key IN (${months})
      GROUP BY sha2(concat_ws('||', company_key, person_key,
        coalesce(nullif(trim(numero_conta_medica), ''), 'SEM_CONTA'),
        coalesce(nullif(trim(authorization_id), ''), 'SEM_SENHA'),
        coalesce(nullif(trim(prestador), ''), 'SEM_PRESTADOR')), 256)
      ORDER BY 1`,
    ),
    q(
      `SELECT month_key, posicao FROM (
        SELECT month_key, person_key,
          row_number() OVER (PARTITION BY month_key ORDER BY custo_assistencial_bruto DESC, person_key) AS posicao
        FROM ${TABLES.martPessoaMes}
        WHERE company_key = '${companyKey}' AND month_key IN (${months})
      ) WHERE person_key = '${entityKey}'`,
    ),
  ]);

  if (!monthlyRows.length) return null;
  const coveredMonths = await fetchCoveredMonths(q, companyKey, period.usableMonths);
  const rankByMonth = new Map(rankRows.map((row) => [String(getCell(row[0])), toInt(row[1])]));
  const monthlyByKey = new Map(monthlyRows.map((row) => [String(getCell(row[0])), row]));

  return {
    entity_key: entityKey,
    label: maskedBeneficiaryLabel(entityKey),
    age_group: String(getCell(monthlyRows.at(-1)?.[6] as never) || "") || null,
    relationship: String(getCell(monthlyRows.at(-1)?.[7] as never) || "") || null,
    monthly: period.usableMonths.map((month) => {
      const row = monthlyByKey.get(month);
      // Mês coberto sem consumo da pessoa = zero; sem cobertura da empresa = null.
      const covered = coveredMonths.has(month);
      const fallback = covered ? 0 : null;
      return {
        month,
        has_data: Boolean(row),
        covered,
        billing_lines: row ? toInt(row[1]) : fallback,
        service_quantity: row ? toNum(row[2]) : fallback,
        gross_cost: row ? toNum(row[3]) : fallback,
        hospitalization_episodes: row ? toInt(row[4]) : fallback,
        primary_event: row ? String(getCell(row[5]) || "") || null : null,
        rank_position: rankByMonth.get(month) ?? null,
      };
    }),
    events: eventRows.map((row) => ({
      event_type: String(getCell(row[0])),
      billing_lines: toInt(row[1]),
      service_quantity: toNum(row[2]),
      gross_cost: toNum(row[3]),
    })),
    procedures: procedureRows.map((row) => ({
      procedure: String(getCell(row[0])),
      macrogroup: String(getCell(row[1])),
      service_quantity: toNum(row[2]),
      gross_cost: toNum(row[3]),
    })),
    providers: providerRows.map((row) => ({
      provider: String(getCell(row[0])),
      billing_lines: toInt(row[1]),
      gross_cost: toNum(row[2]),
    })),
    hospitalizations: hospitalizationRows.map((row) => ({
      month: String(getCell(row[0])),
      grouping: String(getCell(row[1])),
      duration_days: getCell(row[2]) === null ? null : toNum(row[2]),
      gross_cost: toNum(row[3]),
      mental_health: toInt(row[4]) === 1,
    })),
  };
}
