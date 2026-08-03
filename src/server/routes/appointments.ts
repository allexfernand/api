// api/appointments.ts
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
const APPOINTMENTS_DATE_COLUMN = 'hora_criacao_atendimento';
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
  const groupList = groups.map((group) => `UPPER(TRIM(${p.add(group)}))`).join(',');
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
  'nome_conta',
  'NOME_CONTA',
  'NOME_CLIENTE',
  'nome_cliente',
  'empresa',
  'Empresa',
  'nome_empresa',
  'NOME_EMPRESA',
  'company',
  'company_name',
];

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
  if (!groupNames.length) return '';
  const conditions = [];
  const groupColumn = pickColumn(columns, ['grupo_economico', 'economic_group', 'group_name', 'grupo']);
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (groupColumn) {
    conditions.push(`(${groupNames.map((groupName) => `UPPER(TRIM(CAST(${quoteIdent(groupColumn)} AS STRING))) LIKE CONCAT('%', UPPER(TRIM(${p.add(groupName)})), '%')`).join(' OR ')})`);
  }
  if (companyColumn) {
    conditions.push(`UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${orgNamesSubquery(groupNames, p)}`);
  }
  return conditions.length ? `AND (${conditions.join(' OR ')})` : '';
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
  if (!partnerBrokerId) return '';
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return '';
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${partnerOrgNamesSubquery(partnerBrokerId, p)}`;
}

function buildCompanyFilter(columns: string[], company: unknown, p: SqlParams) {
  if (!company) return '';
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return '';
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
    const m = String(dd.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${y}-${m}`);
  }
  return out;
}

function nextMonth(month: string) {
  const [year, mm] = month.split('-').map((value) => parseInt(value, 10));
  const d = new Date(Date.UTC(year, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

  const meses     = req.query.meses ? String(req.query.meses).split(',').filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  const groupName = groupNames[0] || null;
  const company = req.query.company || null;
  const partnerBrokerId = await scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const distinctCpf = req.query.dedupe === 'distinct_cpf' || req.query.dedupe === 'cpf_day';
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(String(req.query.months)) || 12, 1), 24));
  const monthRangeFilter = monthList.map((month) => `(
    ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${month}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(month)}-01'
  )`).join(' OR ');
  const typeExpr = `CASE
    WHEN UPPER(assunto) LIKE '%DASA%' THEN 'Exames - DASA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' AND UPPER(assunto) LIKE '%PA%' THEN 'Conexa PA'
    WHEN UPPER(assunto) LIKE '%CONEXA%' THEN 'Conexa Eletiva'
    WHEN UPPER(assunto) LIKE '%DENTIST%' OR UPPER(assunto) LIKE '%ODONTO%'
         OR UPPER(assunto) LIKE '%ENDODONT%' OR UPPER(assunto) LIKE '%ORTODONT%'
         OR UPPER(assunto) LIKE '%PROTESIST%' OR UPPER(assunto) LIKE '%BUCOMAXILO%'
         OR UPPER(assunto) LIKE '%BUCO MAXILO%' OR UPPER(assunto) LIKE '%PERIODONT%' THEN 'Odontologia'
    WHEN UPPER(assunto) LIKE '%PSICOLOG%' OR UPPER(assunto) LIKE '%PSIC_LOG%'
         OR UPPER(assunto) LIKE '%NEUROPSIC%' OR UPPER(assunto) LIKE '%PSICOPEDAG%'
         OR UPPER(assunto) LIKE '%NUTRICION%' OR UPPER(assunto) LIKE '%NUTRI__%'
         OR UPPER(assunto) LIKE '%FISIOTERA%'
         OR UPPER(assunto) LIKE '%FONOAUDIO%' OR UPPER(assunto) LIKE '%FONOTERAPIA%'
         OR UPPER(assunto) LIKE '%TERAPIA OCUPACIONAL%' THEN 'Terapias'
    WHEN tipo_solicitacao = 'Médico' THEN 'Consultas'
    WHEN tipo_solicitacao IN ('Exame', 'Exames') THEN 'Exames'
    ELSE 'Outros'
  END`;

  try {
    const warehouseId = await resolveWarehouseId();
    const columns = (groupNames.length || company || partnerBrokerId) ? await getColumns(warehouseId, APPOINTMENTS_TABLE) : [];
    const params = createSqlParams();
    const groupFilter = buildGroupFilter(columns, groupNames, params);
    const companyFilter = buildCompanyFilter(columns, company, params);
    const partnerFilter = buildPartnerFilter(columns, partnerBrokerId, params);

    const rows = await runQuery(warehouseId, distinctCpf ? `
      WITH typed_rows AS (
        SELECT
          ${typeExpr} AS tipo_agrupado,
          LPAD(REGEXP_REPLACE(CAST(cpf_atendido AS STRING), '[^0-9]', ''), 11, '0') AS cpf_norm
        FROM ${APPOINTMENTS_TABLE}
        WHERE (${monthRangeFilter})
          AND cpf_atendido IS NOT NULL
          AND TRIM(CAST(cpf_atendido AS STRING)) != ''
          AND UPPER(assunto) NOT IN (
            'ATENDIMENTO WHATSAPP',
            'ATENDIMENTO HUMANO',
            'FORA DE HORÁRIO DE ATENDIMENTO'
          )
          AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
          AND UPPER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%ATENDIMENTO HUMANO%'
          AND UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' '))) NOT LIKE '%ATENDIMENTO%HUMANO%'
          AND NOT (
            assunto RLIKE '^[A-Z][a-z]+ [A-Z]'
            OR assunto RLIKE '^[A-Z][A-Z]+ [A-Z]'
            OR assunto RLIKE '^ [A-Z]'
          )
          ${groupFilter}
          ${companyFilter}
          ${partnerFilter}
      ),
      deduped AS (
        SELECT DISTINCT tipo_agrupado, cpf_norm
        FROM typed_rows
        WHERE cpf_norm IS NOT NULL
          AND cpf_norm != ''
          AND cpf_norm != '00000000000'
      ),
      grouped AS (
        SELECT tipo_agrupado, COUNT(*) AS total
        FROM deduped
        GROUP BY tipo_agrupado
      )
      SELECT SUM(total) AS total_tickets
      FROM grouped
    ` : `
      SELECT COUNT(*) AS total_tickets
      FROM ${APPOINTMENTS_TABLE}
      WHERE (${monthRangeFilter})
        AND UPPER(assunto) NOT IN (
          'ATENDIMENTO WHATSAPP',
          'ATENDIMENTO HUMANO',
          'FORA DE HORÁRIO DE ATENDIMENTO'
        )
        AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
        AND UPPER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%ATENDIMENTO HUMANO%'
        AND UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' '))) NOT LIKE '%ATENDIMENTO%HUMANO%'
        AND NOT (
          assunto RLIKE '^[A-Z][a-z]+ [A-Z]'
          OR assunto RLIKE '^[A-Z][A-Z]+ [A-Z]'
          OR assunto RLIKE '^ [A-Z]'
        )
        ${groupFilter}
        ${companyFilter}
        ${partnerFilter}
    `, params.list);

    res.status(200).json({
      total: toInt(rows[0]?.[0]),
      months: monthList,
      source: "atendimento_summarized_gold_live",
      filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId, dedupe: distinctCpf ? 'distinct_cpf' : null },
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
