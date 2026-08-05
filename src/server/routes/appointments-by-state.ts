// api/appointments-by-state.ts
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

const APPOINTMENTS_TABLE = `hive_metastore.sanus_prod.atendimento_summarized_gold_live`;
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

function normalizeCpfSql(expr: string) {
  return `NULLIF(LPAD(REGEXP_REPLACE(CAST(${expr} AS STRING), '[^0-9]', ''), 11, '0'), '00000000000')`;
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

/** Fallback cidade → UF para agendamentos sem match em vw_beneficiarios. */
function cityToUfSql(cidadeExpr: string) {
  return `
    CASE
      WHEN ${cidadeExpr} RLIKE '(?i)^(s[aã]o\\s*paulo|campinas|guarulhos|osasco|barueri|tabo[aã]o|santo\\s*andr[eé]|s[aã]o\\s*bernardo|mogi|indaiatuba|sorocaba|jundia[ií]|santos|ribeir[aã]o\\s*preto)$' THEN 'SP'
      WHEN ${cidadeExpr} RLIKE '(?i)^(rio\\s*de\\s*janeiro|niter[oó]i|nova\\s*igua[cç]u|duque\\s*de\\s*caxias|s[aã]o\\s*gon[cç]alo)$' THEN 'RJ'
      WHEN ${cidadeExpr} RLIKE '(?i)^(belo\\s*horizonte|uberl[aâ]ndia|contagem|juiz\\s*de\\s*fora)$' THEN 'MG'
      WHEN ${cidadeExpr} RLIKE '(?i)^(curitiba|londrina|maring[aá])$' THEN 'PR'
      WHEN ${cidadeExpr} RLIKE '(?i)^(porto\\s*alegre|caxias\\s*do\\s*sul|s[aã]o\\s*leopoldo)$' THEN 'RS'
      WHEN ${cidadeExpr} RLIKE '(?i)^(florian[oó]polis|joinville|blumenau)$' THEN 'SC'
      WHEN ${cidadeExpr} RLIKE '(?i)^(salvador|feira\\s*de\\s*santana)$' THEN 'BA'
      WHEN ${cidadeExpr} RLIKE '(?i)^(recife|olinda|jaboat[aã]o)$' THEN 'PE'
      WHEN ${cidadeExpr} RLIKE '(?i)^(fortaleza)$' THEN 'CE'
      WHEN ${cidadeExpr} RLIKE '(?i)^(bras[ií]lia|distrito\\s*federal)$' THEN 'DF'
      WHEN ${cidadeExpr} RLIKE '(?i)^(goi[aâ]nia)$' THEN 'GO'
      WHEN ${cidadeExpr} RLIKE '(?i)^(manaus)$' THEN 'AM'
      WHEN ${cidadeExpr} RLIKE '(?i)^(bel[eé]m)$' THEN 'PA'
      WHEN ${cidadeExpr} RLIKE '(?i)^(macei[oó])$' THEN 'AL'
      WHEN ${cidadeExpr} RLIKE '(?i)^(aracaju)$' THEN 'SE'
      WHEN ${cidadeExpr} RLIKE '(?i)^(natal)$' THEN 'RN'
      WHEN ${cidadeExpr} RLIKE '(?i)^(jo[aã]o\\s*pessoa)$' THEN 'PB'
      WHEN ${cidadeExpr} RLIKE '(?i)^(vit[oó]ria)$' THEN 'ES'
      WHEN ${cidadeExpr} RLIKE '(?i)^(cuiab[aá])$' THEN 'MT'
      WHEN ${cidadeExpr} RLIKE '(?i)^(campo\\s*grande)$' THEN 'MS'
      ELSE NULL
    END
  `;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

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
    const columns = await getColumns(warehouseId, APPOINTMENTS_TABLE);
    const params = createSqlParams();
    const groupFilter = buildGroupFilter(columns, groupNames, params);
    const companyFilter = buildCompanyFilter(columns, company, params);
    const partnerFilter = buildPartnerFilter(columns, partnerBrokerId, params);
    const recordColumn = pickColumn(columns, appointmentRecordColumnCandidates);
    const recordKeyExpr = recordColumn
      ? `CAST(${quoteIdent(recordColumn)} AS STRING)`
      : `CONCAT(COALESCE(CAST(cpf_atendido AS STRING), ''), '|', COALESCE(CAST(${quoteIdent(APPOINTMENTS_DATE_COLUMN)} AS STRING), ''))`;

    const rows = await runQuery(
      warehouseId,
      `
      WITH filtered AS (
        SELECT DISTINCT
          ${recordKeyExpr} AS record_key,
          ${normalizeCpfSql("cpf_atendido")} AS cpf_norm,
          UPPER(TRIM(COALESCE(CAST(cidade AS STRING), ''))) AS cidade_norm
        FROM ${APPOINTMENTS_TABLE}
        WHERE (${monthRangeFilter})
          ${assuntoExclusionSql()}
          ${groupFilter}
          ${companyFilter}
          ${partnerFilter}
          ${recordColumn ? `AND ${quoteIdent(recordColumn)} IS NOT NULL` : ""}
      ),
      beneficiary_uf AS (
        SELECT
          ${normalizeCpfSql("CPF_BENEFICIARIO")} AS cpf_norm,
          MAX(UPPER(TRIM(CAST(UF AS STRING)))) AS uf
        FROM ${BENEFICIARIES_VIEW}
        WHERE CPF_BENEFICIARIO IS NOT NULL
          AND UF IS NOT NULL
          AND TRIM(CAST(UF AS STRING)) != ''
        GROUP BY ${normalizeCpfSql("CPF_BENEFICIARIO")}
      ),
      classified AS (
        SELECT
          f.record_key,
          COALESCE(
            NULLIF(bu.uf, ''),
            ${cityToUfSql("f.cidade_norm")}
          ) AS uf
        FROM filtered f
        LEFT JOIN beneficiary_uf bu
          ON bu.cpf_norm = f.cpf_norm
         AND f.cpf_norm IS NOT NULL
      )
      SELECT
        COALESCE(uf, 'SEM UF') AS uf,
        COUNT(*) AS total
      FROM classified
      GROUP BY COALESCE(uf, 'SEM UF')
      ORDER BY total DESC
    `,
      params.list,
    );

    const states = rows.map((row) => ({
      uf: String(getCell(row[0]) || "SEM UF"),
      total: toInt(row[1]),
    }));
    const total = states.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const withoutUf = states.find((item) => item.uf === "SEM UF")?.total || 0;

    res.status(200).json({
      months: monthList,
      total,
      without_uf: withoutUf,
      states: states.filter((item) => item.uf !== "SEM UF"),
      source: "atendimento_summarized_gold_live + vw_beneficiarios.UF (fallback cidade)",
      filters: {
        group_name: groupName,
        company,
        partner_broker_id: partnerBrokerId,
      },
      record_column: recordColumn,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
