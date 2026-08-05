// api/appointments-by-city.ts
// Mesmo universo do KPI; detalha volume por cidade dentro de uma UF.
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
} from "../../../lib/basic-auth";
import { CORE_DATA_MENUS } from "../../dashboard/menu-catalog";
import { createSqlParams, getCell, getColumns, quoteIdent, resolveWarehouseId, runQuery, toInt, type SqlParams } from "../../../lib/databricks";
import { setApiCors } from "../../../lib/http";

const KPI_TABLE = `hive_metastore.sanus_prod.atendimento_summarized_gold_live`;
const LOCATION_TABLE = `hive_metastore.sanus_prod.atendimento_gold_live`;
const APPOINTMENTS_DATE_COLUMN = "hora_criacao_atendimento";
const BENEFICIARIES_VIEW = `hive_metastore.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

type ApiRequest = { method?: string; query: Record<string, string | string[] | undefined> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

function pickColumn(columns: string[], candidates: string[]) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

function orgNamesSubquery(groupName: unknown, p: SqlParams) {
  const groups = (Array.isArray(groupName) ? groupName : [groupName]).map((value) => String(value).trim()).filter(Boolean);
  const groupList = groups.map((group) => `UPPER(TRIM(${p.add(group)}))`).join(",");
  return `(
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE UPPER(TRIM(name)) IN (${groupList})
    UNION
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE UPPER(TRIM(name)) IN (${groupList})
    )
  )`;
}

const companyColumnCandidates = [
  "nome_conta",
  "NOME_CONTA",
  "NOME_CLIENTE",
  "nome_cliente",
  "empresa",
  "Empresa",
  "nome_empresa",
  "NOME_EMPRESA",
  "company",
  "company_name",
];

const appointmentRecordColumnCandidates = [
  "id_unico",
  "identificacao_atendimento",
  "record_id",
  "registro_id",
  "card_uuid",
  "card_id",
  "id_card",
  "cardId",
  "agendamento_id",
  "id_agendamento",
  "appointment_id",
  "atendimento_id",
  "id_atendimento",
  "ticket_id",
  "solicitacao_id",
  "id_solicitacao",
  "protocolo",
  "protocol",
  "id",
];

function assuntoExclusionSql() {
  return `
    AND UPPER(assunto) NOT IN (
      'ATENDIMENTO WHATSAPP',
      'ATENDIMENTO HUMANO',
      'FORA DE HORÁRIO DE ATENDIMENTO'
    )
    AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
    AND UPPER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%ATENDIMENTO HUMANO%'
    AND UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' '))) NOT LIKE '%ATENDIMENTO%HUMANO%'
  `;
}

function parseGroupNames(query: Record<string, any>) {
  const raw = query.group_names;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return [...new Set(parsed.map((v) => String(v).trim()).filter(Boolean))];
    } catch {}
  }
  return query.group_name ? [String(query.group_name).trim()].filter(Boolean) : [];
}

function buildGroupFilter(columns: string[], groupNames: string[], p: SqlParams) {
  if (!groupNames.length) return "";
  const conditions = [];
  const groupColumn = pickColumn(columns, ["grupo_economico", "economic_group", "group_name", "grupo"]);
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (groupColumn) {
    conditions.push(`(${groupNames.map((groupName) => `UPPER(TRIM(CAST(${quoteIdent(groupColumn)} AS STRING))) LIKE CONCAT('%', UPPER(TRIM(${p.add(groupName)})), '%')`).join(" OR ")})`);
  }
  if (companyColumn) {
    conditions.push(`UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${orgNamesSubquery(groupNames, p)}`);
  }
  return conditions.length ? `AND (${conditions.join(" OR ")})` : "";
}

function partnerOrgNamesSubquery(partnerBrokerId: unknown, p: SqlParams) {
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  const partnerCondition = partnerIds.length
    ? `CAST(opb.partner_broker_id AS STRING) IN (${p.addAll(partnerIds)})`
    : String(partnerBrokerId) === MDS_PARTNER_SCOPE
    ? `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`
    : `CAST(opb.partner_broker_id AS STRING) = ${p.add(partnerBrokerId)}`;
  return `(
    SELECT UPPER(TRIM(o.name))
    FROM ${ORGANIZATIONS_TABLE} o
    INNER JOIN ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      ON CAST(o.id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION ALL
    SELECT UPPER(TRIM(child.name))
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function buildPartnerFilter(columns: string[], partnerBrokerId: unknown, p: SqlParams) {
  if (!partnerBrokerId) return "";
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return "";
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${partnerOrgNamesSubquery(partnerBrokerId, p)}`;
}

function buildCompanyFilter(columns: string[], company: unknown, p: SqlParams) {
  if (!company) return "";
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return "";
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM(${p.add(company)}))`;
}

function lastNMonthsList(n: number) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(d.getUTCMonth() - i);
    const y = dd.getUTCFullYear();
    const m = String(dd.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${y}-${m}`);
  }
  return out;
}

function nextMonth(month: string) {
  const [year, mm] = month.split("-").map((value) => parseInt(value, 10));
  const d = new Date(Date.UTC(year, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeCitySql(expr: string) {
  return `NULLIF(
    TRIM(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          TRANSLATE(
            UPPER(TRIM(COALESCE(CAST(${expr} AS STRING), ''))),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
            'AAAAAEEEEIIIIOOOOOUUUUCNAAAAAEEEEIIIIOOOOOUUUUCN'
          ),
          ' - [A-Z]{3}$',
          ''
        ),
        ' +',
        ' '
      )
    ),
    ''
  )`;
}

function cityAsUfSql(cidadeExpr: string) {
  return `
    CASE
      WHEN ${cidadeExpr} RLIKE '^[A-Z]{2}$' THEN ${cidadeExpr}
      WHEN ${cidadeExpr} IN ('SAO PAULO') THEN 'SP'
      WHEN ${cidadeExpr} IN ('RIO DE JANEIRO') THEN 'RJ'
      WHEN ${cidadeExpr} IN ('MINAS GERAIS') THEN 'MG'
      WHEN ${cidadeExpr} IN ('PARANA') THEN 'PR'
      WHEN ${cidadeExpr} IN ('RIO GRANDE DO SUL') THEN 'RS'
      WHEN ${cidadeExpr} IN ('SANTA CATARINA') THEN 'SC'
      WHEN ${cidadeExpr} IN ('BAHIA') THEN 'BA'
      WHEN ${cidadeExpr} IN ('PERNAMBUCO') THEN 'PE'
      WHEN ${cidadeExpr} IN ('CEARA') THEN 'CE'
      WHEN ${cidadeExpr} IN ('DISTRITO FEDERAL') THEN 'DF'
      WHEN ${cidadeExpr} IN ('GOIAS') THEN 'GO'
      WHEN ${cidadeExpr} IN ('AMAZONAS') THEN 'AM'
      WHEN ${cidadeExpr} IN ('PARA') THEN 'PA'
      WHEN ${cidadeExpr} IN ('ALAGOAS') THEN 'AL'
      WHEN ${cidadeExpr} IN ('SERGIPE') THEN 'SE'
      WHEN ${cidadeExpr} IN ('RIO GRANDE DO NORTE') THEN 'RN'
      WHEN ${cidadeExpr} IN ('PARAIBA') THEN 'PB'
      WHEN ${cidadeExpr} IN ('ESPIRITO SANTO') THEN 'ES'
      WHEN ${cidadeExpr} IN ('MATO GROSSO') THEN 'MT'
      WHEN ${cidadeExpr} IN ('MATO GROSSO DO SUL') THEN 'MS'
      WHEN ${cidadeExpr} IN ('PIAUI') THEN 'PI'
      WHEN ${cidadeExpr} IN ('MARANHAO') THEN 'MA'
      WHEN ${cidadeExpr} IN ('TOCANTINS') THEN 'TO'
      WHEN ${cidadeExpr} IN ('ACRE') THEN 'AC'
      WHEN ${cidadeExpr} IN ('RONDONIA') THEN 'RO'
      WHEN ${cidadeExpr} IN ('RORAIMA') THEN 'RR'
      WHEN ${cidadeExpr} IN ('AMAPA') THEN 'AP'
      ELSE NULL
    END
  `;
}

function cityToUfSql(cidadeExpr: string) {
  return `
    CASE
      WHEN ${cidadeExpr} RLIKE '^(SAO PAULO|CAMPINAS|GUARULHOS|OSASCO|BARUERI|TABOAO|TABOAO DA SERRA|SANTO ANDRE|SAO BERNARDO|MOGI|MOGI DAS CRUZES|INDAIATUBA|SOROCABA|JUNDIAI|SANTOS|RIBEIRAO PRETO|BRAGANCA PAULISTA|VALINHOS|SUMARE|ITATIBA|SAO JOSE DO RIO PRETO)$' THEN 'SP'
      WHEN ${cidadeExpr} RLIKE '^(RIO DE JANEIRO|NITEROI|NOVA IGUACU|DUQUE DE CAXIAS|SAO GONCALO|MARICA)$' THEN 'RJ'
      WHEN ${cidadeExpr} RLIKE '^(BELO HORIZONTE|UBERLANDIA|CONTAGEM|JUIZ DE FORA|CONFINS|PAMPULHA|ITAUNA|LAGOA SANTA|POCOS DE CALDAS)$' THEN 'MG'
      WHEN ${cidadeExpr} RLIKE '^(CURITIBA|LONDRINA|MARINGA|SAO JOSE DOS PINHAIS|FOZ DO IGUACU)$' THEN 'PR'
      WHEN ${cidadeExpr} RLIKE '^(PORTO ALEGRE|CAXIAS DO SUL|SAO LEOPOLDO|GRAVATAI|CACHOEIRINHA|NOVO HAMBURGO)$' THEN 'RS'
      WHEN ${cidadeExpr} RLIKE '^(FLORIANOPOLIS|JOINVILLE|BLUMENAU)$' THEN 'SC'
      WHEN ${cidadeExpr} RLIKE '^(SALVADOR|FEIRA DE SANTANA|VITORIA DA CONQUISTA)$' THEN 'BA'
      WHEN ${cidadeExpr} RLIKE '^(RECIFE|OLINDA|JABOATAO|JABOATAO DOS GUARARAPES)$' THEN 'PE'
      WHEN ${cidadeExpr} = 'FORTALEZA' THEN 'CE'
      WHEN ${cidadeExpr} IN ('BRASILIA', 'DISTRITO FEDERAL') THEN 'DF'
      WHEN ${cidadeExpr} = 'GOIANIA' THEN 'GO'
      WHEN ${cidadeExpr} = 'MANAUS' THEN 'AM'
      WHEN ${cidadeExpr} RLIKE '^(BELEM|ABAETETUBA|ANANINDEUA|SANTAREM)$' THEN 'PA'
      WHEN ${cidadeExpr} RLIKE '^(MACEIO|SAO MIGUEL DOS CAMPOS)$' THEN 'AL'
      WHEN ${cidadeExpr} = 'ARACAJU' THEN 'SE'
      WHEN ${cidadeExpr} = 'NATAL' THEN 'RN'
      WHEN ${cidadeExpr} = 'JOAO PESSOA' THEN 'PB'
      WHEN ${cidadeExpr} = 'VITORIA' THEN 'ES'
      WHEN ${cidadeExpr} = 'CUIABA' THEN 'MT'
      WHEN ${cidadeExpr} = 'CAMPO GRANDE' THEN 'MS'
      WHEN ${cidadeExpr} = 'PALMAS' THEN 'TO'
      WHEN ${cidadeExpr} RLIKE 'CAMPOS DOS GOYTACA' THEN 'RJ'
      WHEN ${cidadeExpr} RLIKE 'SAO JOAO DE MERITI|SAO JOAO DE MEITI' THEN 'RJ'
      ELSE NULL
    END
  `;
}

function resolveUfSql(cidadeExpr: string) {
  return `COALESCE(
    ${cityAsUfSql(cidadeExpr)},
    NULLIF(cu.uf, ''),
    ${cityToUfSql(cidadeExpr)}
  )`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

  const uf = String(req.query.uf || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) {
    return res.status(400).json({ error: "Parâmetro uf obrigatório (ex.: SP)" });
  }

  const meses = req.query.meses ? String(req.query.meses).split(",").filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  const groupName = groupNames[0] || null;
  const company = req.query.company || null;
  const partnerBrokerId = await scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const monthList = meses.length
    ? meses.sort()
    : lastNMonthsList(Math.min(Math.max(parseInt(String(req.query.months)) || 12, 1), 24));
  const monthRangeFilter = monthList
    .map(
      (month) => `(
    ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${month}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(month)}-01'
  )`,
    )
    .join(" OR ");

  try {
    const warehouseId = await resolveWarehouseId();
    const columns = await getColumns(warehouseId, KPI_TABLE);
    const params = createSqlParams();
    const groupFilter = buildGroupFilter(columns, groupNames, params);
    const companyFilter = buildCompanyFilter(columns, company, params);
    const partnerFilter = buildPartnerFilter(columns, partnerBrokerId, params);
    const recordColumn = pickColumn(columns, appointmentRecordColumnCandidates);
    const recordKeyExpr = recordColumn
      ? `CAST(${quoteIdent(recordColumn)} AS STRING)`
      : `CONCAT(COALESCE(CAST(cpf_atendido AS STRING), ''), '|', COALESCE(CAST(${quoteIdent(APPOINTMENTS_DATE_COLUMN)} AS STRING), ''))`;
    const ufParam = params.add(uf);

    const rows = await runQuery(
      warehouseId,
      `
      WITH kpi AS (
        SELECT
          ${recordKeyExpr} AS record_key
        FROM ${KPI_TABLE}
        WHERE (${monthRangeFilter})
          ${assuntoExclusionSql()}
          ${groupFilter}
          ${companyFilter}
          ${partnerFilter}
          ${recordColumn ? `AND ${quoteIdent(recordColumn)} IS NOT NULL` : ""}
        GROUP BY ${recordKeyExpr}
      ),
      location AS (
        SELECT
          CAST(${quoteIdent(recordColumn || "id_unico")} AS STRING) AS record_key,
          ${normalizeCitySql("cidade")} AS cidade_norm,
          ROW_NUMBER() OVER (
            PARTITION BY CAST(${quoteIdent(recordColumn || "id_unico")} AS STRING)
            ORDER BY COALESCE(${quoteIdent(APPOINTMENTS_DATE_COLUMN)}, TIMESTAMP('1970-01-01')) DESC
          ) AS rn
        FROM ${LOCATION_TABLE}
        WHERE ${recordColumn ? `${quoteIdent(recordColumn)} IS NOT NULL` : "id_unico IS NOT NULL"}
          AND CAST(${quoteIdent(recordColumn || "id_unico")} AS STRING) IN (SELECT record_key FROM kpi)
      ),
      city_uf AS (
        SELECT
          ${normalizeCitySql("CIDADE")} AS cidade_norm,
          MAX(UPPER(TRIM(CAST(UF AS STRING)))) AS uf
        FROM ${BENEFICIARIES_VIEW}
        WHERE CIDADE IS NOT NULL
          AND TRIM(CAST(CIDADE AS STRING)) != ''
          AND UF IS NOT NULL
          AND TRIM(CAST(UF AS STRING)) != ''
          AND UPPER(TRIM(CAST(UF AS STRING))) RLIKE '^[A-Z]{2}$'
        GROUP BY ${normalizeCitySql("CIDADE")}
      ),
      classified AS (
        SELECT
          k.record_key,
          l.cidade_norm,
          ${resolveUfSql("l.cidade_norm")} AS uf
        FROM kpi k
        LEFT JOIN location l
          ON l.record_key = k.record_key
         AND l.rn = 1
        LEFT JOIN city_uf cu
          ON cu.cidade_norm = l.cidade_norm
         AND l.cidade_norm IS NOT NULL
      )
      SELECT
        cidade_norm AS cidade,
        COUNT(*) AS total
      FROM classified
      WHERE uf = ${ufParam}
        AND cidade_norm IS NOT NULL
      GROUP BY cidade_norm
      ORDER BY total DESC
      LIMIT 80
    `,
      params.list,
    );

    const cities = rows
      .map((row) => ({
        cidade: String(getCell(row[0]) || ""),
        total: toInt(row[1]),
      }))
      .filter((item) => item.cidade);
    const total = cities.reduce((acc, item) => acc + (Number(item.total) || 0), 0);

    res.status(200).json({
      uf,
      months: monthList,
      total,
      cities,
      source: "KPI summarized (id) → atendimento_gold_live.cidade",
      filters: {
        group_name: groupName,
        company,
        partner_broker_id: partnerBrokerId,
        uf,
      },
      record_column: recordColumn,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
