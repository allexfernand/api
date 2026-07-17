// Escopos `family-timeline`, `care-timeline` e `ps-trends`.
// Família: linha do tempo relativa à entrada, com origem da data explícita.
// Coordenação: quadrantes fatura × coordenação por mês.
// PS: itens associados a episódios de pronto-socorro preservando o mês.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { getCell, suppressSmallGroup, toBool, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";

export const FAMILY_UNITS = {
  familias: "famílias",
  pessoas: "pessoas",
  custo: "R$",
  servicos: "serviços",
  internacoes: "episódios",
  mes_relativo: "meses desde a entrada",
};

export async function familyTimelineScope(q: QueryRunner, companyKey: string) {
  const rows = await q(
    `SELECT mes_relativo, sum(familias), sum(pessoas_utilizantes), sum(linhas_cobranca),
      sum(quantidade_servicos), sum(episodios_internacao), round(sum(custo_assistencial_bruto), 2),
      max_by(evento_principal, custo_assistencial_bruto), max(entry_date_source),
      count(DISTINCT coorte_entrada)
    FROM ${TABLES.martFamiliaRelativo}
    WHERE company_key = '${companyKey}'
    GROUP BY mes_relativo
    ORDER BY mes_relativo`,
  );
  return {
    relative_months: rows.map((row) => ({
      relative_month: toInt(row[0]),
      families: toInt(row[1]),
      utilizing_people: toInt(row[2]),
      billing_lines: toInt(row[3]),
      service_quantity: toNum(row[4]),
      hospitalization_episodes: toInt(row[5]),
      gross_cost: toNum(row[6]),
      primary_event: String(getCell(row[7]) || "Sem classificação"),
      entry_date_source: String(getCell(row[8]) || ""),
      cohorts: toInt(row[9]),
    })),
  };
}

export const CARE_UNITS = {
  pessoas: "pessoas",
  familias: "famílias",
  custo: "R$",
  eventos: "eventos de coordenação",
};

export async function careTimelineScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { suppressSmallGroups: boolean },
) {
  if (!period.usableMonths.length) return { monthly: [], demographics: [] };
  const months = monthsInSql(period.usableMonths);
  const [rows, demographicRows] = await Promise.all([
    q(
      `SELECT month_key, utilizou_plano, teve_coordenacao, pessoas, familias, linhas_cobranca,
        custo_assistencial_bruto, eventos_coordenacao, titulares, dependentes, pessoas_sem_ponte_familiar
      FROM ${TABLES.martCoordenacaoMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      ORDER BY month_key, utilizou_plano DESC, teve_coordenacao DESC`,
    ),
    // Cortes demográficos dos quadrantes na janela inteira (pessoa distinta),
    // direto do mart pessoa-nível de fatura × coordenação. Grupos pequenos
    // são suprimidos para perfis externos na serialização.
    q(
      `SELECT d.dimensao, d.valor, m.utilizou_plano, m.teve_coordenacao,
        count(DISTINCT m.person_key), round(sum(m.custo_assistencial_bruto), 2)
      FROM ${TABLES.martCare} m
      LATERAL VIEW explode(array(
        named_struct('dimensao', 'sexo', 'valor', coalesce(nullif(trim(m.sex), ''), 'Não informado')),
        named_struct('dimensao', 'vinculo', 'valor', coalesce(nullif(trim(m.beneficiary_type), ''), 'Não informado')),
        named_struct('dimensao', 'estado', 'valor', coalesce(nullif(trim(m.state), ''), 'Não informado'))
      )) t AS d
      WHERE m.company_key = '${companyKey}' AND m.month_key IN (${months})
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, 2, 3 DESC, 4 DESC`,
    ),
  ]);
  return {
    demographics: demographicRows.map((row) => ({
      dimension: String(getCell(row[0])),
      value: String(getCell(row[1])),
      used_plan: toBool(row[2]),
      had_care_coordination: toBool(row[3]),
      people: suppressSmallGroup(toInt(row[4]), options.suppressSmallGroups),
      gross_cost: toNum(row[5]),
    })),
    monthly: rows.map((row) => ({
      month: String(getCell(row[0])),
      used_plan: toBool(row[1]),
      had_care_coordination: toBool(row[2]),
      people: suppressSmallGroup(toInt(row[3]), options.suppressSmallGroups),
      families: suppressSmallGroup(toInt(row[4]), options.suppressSmallGroups),
      billing_lines: toInt(row[5]),
      gross_cost: toNum(row[6]),
      coordination_events: toInt(row[7]),
      holders: suppressSmallGroup(toInt(row[8]), options.suppressSmallGroups),
      dependents: suppressSmallGroup(toInt(row[9]), options.suppressSmallGroups),
      people_without_family_bridge: toInt(row[10]),
    })),
  };
}

export const PS_UNITS = {
  episodios: "episódios de PS",
  utilizantes: "pessoas",
  servicos: "serviços",
  custo: "R$",
  quantidade_por_episodio: "serviços/episódio",
};

export async function psTrendsScope(
  q: QueryRunner,
  companyKey: string,
  period: ResolvedPeriod,
  options: { limit: number },
) {
  if (!period.usableMonths.length) return { monthly: [], top_items: [] };
  const months = monthsInSql(period.usableMonths);
  const [monthlyRows, itemRows] = await Promise.all([
    q(
      `SELECT month_key, sum(quantidade_servicos), round(sum(custo_assistencial_bruto), 2)
      FROM ${TABLES.martPsItemMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      GROUP BY month_key ORDER BY month_key`,
    ),
    q(
      `SELECT procedimento_key, max(descricao_comercial), max(grupo_comercial),
        sum(episodios_ps), sum(utilizantes), sum(quantidade_servicos),
        round(sum(custo_assistencial_bruto), 2),
        round(sum(quantidade_servicos) / nullif(sum(episodios_ps), 0), 2)
      FROM ${TABLES.martPsItemMes}
      WHERE company_key = '${companyKey}' AND month_key IN (${months})
      GROUP BY procedimento_key
      ORDER BY 7 DESC, procedimento_key
      LIMIT ${options.limit}`,
    ),
  ]);
  const episodesRows = await q(
    `SELECT month_key, count(DISTINCT episode_key)
    FROM ${TABLES.martPsEpisode}
    WHERE company_key = '${companyKey}' AND month_key IN (${months})
    GROUP BY month_key`,
  );
  const episodesByMonth = new Map(episodesRows.map((row) => [String(getCell(row[0])), toInt(row[1])]));
  return {
    monthly: monthlyRows.map((row) => ({
      month: String(getCell(row[0])),
      service_quantity: toNum(row[1]),
      gross_cost: toNum(row[2]),
      ps_episodes: episodesByMonth.get(String(getCell(row[0]))) ?? null,
    })),
    top_items: itemRows.map((row) => ({
      entity_key: String(getCell(row[0])),
      description: String(getCell(row[1]) || "Sem descrição"),
      macrogroup: String(getCell(row[2]) || "Sem classificação"),
      // Soma de episódios mensais: um episódio pode conter vários itens.
      monthly_ps_episodes_sum: toInt(row[3]),
      monthly_utilizers_sum: toInt(row[4]),
      service_quantity: toNum(row[5]),
      gross_cost: toNum(row[6]),
      quantity_per_episode: toNullableNum(row[7]),
    })),
  };
}
