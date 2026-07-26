// Escopos `family-timeline`, `care-timeline` e `ps-trends`.
// Família: linha do tempo relativa à entrada, com origem da data explícita.
// Coordenação: quadrantes fatura × coordenação por mês.
// PS: itens associados a episódios de pronto-socorro preservando o mês.

import type { ResolvedPeriod } from "../period-gate";
import { monthsInSql } from "../period-gate";
import { getCell, suppressSmallGroup, toBool, toInt, toNullableNum, toNum } from "../serializers";
import { TABLES, type QueryRunner } from "../query-runner";
import type { LineageEntry } from "../../../contracts/sinistralidade-v2";

export const FAMILY_UNITS = {
  familias: "famílias",
  pessoas: "pessoas",
  custo: "R$",
  servicos: "serviços",
  internacoes: "episódios",
  mes_relativo: "meses desde a entrada",
};

export const FAMILY_LINEAGE: LineageEntry[] = [
  {
    id: "family-timeline.relative",
    kind: "block",
    label: "Custo por mês relativo à entrada da família",
    layer: "mart",
    sources: [
      {
        object: TABLES.martFamiliaRelativo,
        role: "fato principal",
        columns: [
          "mes_relativo",
          "familias",
          "pessoas_utilizantes",
          "linhas_cobranca",
          "quantidade_servicos",
          "episodios_internacao",
          "custo_assistencial_bruto",
          "evento_principal",
          "entry_date_source",
          "coorte_entrada",
        ],
      },
    ],
    formula:
      "O eixo não é o calendário: é o mês relativo à entrada do titular. Mês 0 é a entrada; negativos são anteriores.",
    filters: ["company_key do escopo do usuário, aplicado no SQL"],
    notes: [
      "A entrada familiar é derivada do snapshot atual de elegibilidade, não de histórico retroativo.",
      "Dependentes sem ponte com o titular não estão associados: vw_beneficiarios não expõe essa identidade na origem.",
    ],
    related: ["care-timeline.matrix"],
  },
];

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

export const CARE_LINEAGE: LineageEntry[] = [
  {
    id: "care-timeline.matrix",
    kind: "block",
    label: "Fatura contra coordenação por mês",
    layer: "mart",
    sources: [
      {
        object: TABLES.martCoordenacaoMes,
        role: "fato principal",
        columns: [
          "month_key",
          "utilizou_plano",
          "teve_coordenacao",
          "pessoas",
          "familias",
          "linhas_cobranca",
          "custo_assistencial_bruto",
          "eventos_coordenacao",
          "titulares",
          "dependentes",
          "pessoas_sem_ponte_familiar",
        ],
      },
      {
        object: TABLES.martCare,
        role: "quebra demográfica da matriz; dimensões demográficas sintetizadas via LATERAL VIEW explode",
        columns: ["person_key", "company_key", "month_key", "sex", "beneficiary_type", "state", "utilizou_plano", "teve_coordenacao", "custo_assistencial_bruto"],
      },
    ],
    formula:
      "Matriz de quatro quadrantes por mês: usou o plano × teve coordenação. Cada célula conta pessoas e famílias.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
      "no perfil MDS, grupos pequenos são suprimidos",
    ],
    notes: [
      "A ponte com coordenação usa empresa e CPF do titular, sem expor CPF: cobre contatos digitais DO TITULAR.",
      "Dependente atendido digitalmente não casa com o titular e cai fora do quadrante coordenado.",
      "Dimensões demográficas (sexo, vínculo, estado) são sintetizadas via LATERAL VIEW explode de colunas sex, beneficiary_type, state.",
    ],
    related: ["family-timeline.relative"],
  },
];

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
    demographics: demographicRows.map((row) => {
      const rawPeople = toInt(row[4]);
      const people = suppressSmallGroup(rawPeople, options.suppressSmallGroups);
      // Supressão em cascata (GOV-08): célula com contagem suprimida não pode
      // expor o custo do grupo pequeno — inferência de identidade.
      const suppressed = people === null && rawPeople !== 0;
      return {
        dimension: String(getCell(row[0])),
        value: String(getCell(row[1])),
        used_plan: toBool(row[2]),
        had_care_coordination: toBool(row[3]),
        people,
        gross_cost: suppressed ? null : toNum(row[5]),
      };
    }),
    monthly: rows.map((row) => {
      const rawPeople = toInt(row[3]);
      const people = suppressSmallGroup(rawPeople, options.suppressSmallGroups);
      const suppressed = people === null && rawPeople !== 0;
      return {
        month: String(getCell(row[0])),
        used_plan: toBool(row[1]),
        had_care_coordination: toBool(row[2]),
        people,
        families: suppressSmallGroup(toInt(row[4]), options.suppressSmallGroups),
        billing_lines: suppressed ? null : toInt(row[5]),
        gross_cost: suppressed ? null : toNum(row[6]),
        coordination_events: suppressed ? null : toInt(row[7]),
        holders: suppressSmallGroup(toInt(row[8]), options.suppressSmallGroups),
        dependents: suppressSmallGroup(toInt(row[9]), options.suppressSmallGroups),
        people_without_family_bridge: suppressSmallGroup(toInt(row[10]), options.suppressSmallGroups),
      };
    }),
  };
}

export const PS_UNITS = {
  episodios: "episódios de PS",
  utilizantes: "pessoas",
  servicos: "serviços",
  custo: "R$",
  quantidade_por_episodio: "serviços/episódio",
};

export const PS_LINEAGE: LineageEntry[] = [
  {
    id: "ps-trends.monthly",
    kind: "block",
    label: "Pronto-socorro ao longo do tempo",
    layer: "mart",
    sources: [
      {
        object: TABLES.martPsItemMes,
        role: "itens consumidos no pacote de PS",
        columns: [
          "month_key",
          "procedimento_key",
          "descricao_comercial",
          "grupo_comercial",
          "quantidade_servicos",
          "custo_assistencial_bruto",
          "episodios_ps",
          "utilizantes",
        ],
      },
      {
        object: TABLES.martPsEpisode,
        role: "contagem de episódios de PS",
        columns: ["month_key", "episode_key"],
      },
    ],
    formula:
      "Série mensal de custo e serviços dos itens de PS, e COUNT(DISTINCT episode_key) para o número de episódios.",
    filters: [
      "company_key do escopo do usuário, aplicado no SQL",
      "meses aprovados pelo gate de fechamento",
    ],
    notes: [
      "O episódio canônico associa pessoa, conta, autorização, data e prestador — é o que evita contar o mesmo atendimento várias vezes.",
    ],
    related: ["hospitalization-trends.monthly"],
  },
];

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
