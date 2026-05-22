// api/appointments.ts
import { MDS_PARTNER_SCOPE, requireBasicAuth, scopedPartnerBrokerId } from "../lib/basic-auth";

declare const process: { env: Record<string, string | undefined> };

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const APPOINTMENTS_TABLE = `hive_metastore.sanus_prod.atendimento_summarized_gold_live`;
const APPOINTMENTS_DATE_COLUMN = 'hora_criacao_atendimento';
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

type DbOptions = RequestInit & { headers?: Record<string, string> };
type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
type DatabricksRow = DatabricksCell[];
type ApiRequest = { method?: string; query: Record<string, string | string[] | undefined> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
type Warehouse = { id: string; state?: string };

async function dbFetch(path: string, options: DbOptions = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId: string, sql: string): Promise<DatabricksRow[]> {
  let data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "50s", on_wait_timeout: "CONTINUE" }),
  });
  let { statement_id: sid, status: { state } } = data;
  while (state === "PENDING" || state === "RUNNING") {
    await new Promise((r) => setTimeout(r, 2000));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || "Query falhou: " + state);
  return data.result?.data_array || [];
}

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
const escape = (s: unknown) => String(s).replace(/'/g, "''");
const quoteIdent = (s: unknown) => `\`${String(s).replace(/`/g, "``")}\``;

function pickColumn(columns: string[], candidates: string[]) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

async function getColumns(warehouseId: string, tableName: string) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((column) => column && !column.startsWith('#'));
}

function orgNamesSubquery(groupName: unknown) {
  const groups = (Array.isArray(groupName) ? groupName : [groupName]).map((value) => String(value).trim()).filter(Boolean);
  const groupList = groups.map((group) => `UPPER(TRIM('${escape(group)}'))`).join(',');
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

function buildGroupFilter(columns: string[], groupNames: string[]) {
  if (!groupNames.length) return '';
  const conditions = [];
  const groupColumn = pickColumn(columns, ['grupo_economico', 'economic_group', 'group_name', 'grupo']);
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (groupColumn) {
    conditions.push(`(${groupNames.map((groupName) => `UPPER(TRIM(CAST(${quoteIdent(groupColumn)} AS STRING))) LIKE CONCAT('%', UPPER(TRIM('${escape(groupName)}')), '%')`).join(' OR ')})`);
  }
  if (companyColumn) {
    conditions.push(`UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${orgNamesSubquery(groupNames)}`);
  }
  return conditions.length ? `AND (${conditions.join(' OR ')})` : '';
}

function partnerOrgNamesSubquery(partnerBrokerId: unknown) {
  const partnerCondition = String(partnerBrokerId) === MDS_PARTNER_SCOPE
    ? `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`
    : `CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'`;
  return `(
    SELECT UPPER(TRIM(o.name))
    FROM ${ORGANIZATIONS_TABLE} o
    INNER JOIN ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      ON CAST(o.id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION
    SELECT UPPER(TRIM(child.name))
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function buildPartnerFilter(columns: string[], partnerBrokerId: unknown) {
  if (!partnerBrokerId) return '';
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return '';
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) IN ${partnerOrgNamesSubquery(partnerBrokerId)}`;
}

function buildCompanyFilter(columns: string[], company: unknown) {
  if (!company) return '';
  const companyColumn = pickColumn(columns, companyColumnCandidates);
  if (!companyColumn) return '';
  return `AND UPPER(TRIM(CAST(${quoteIdent(companyColumn)} AS STRING))) = UPPER(TRIM('${escape(company)}'))`;
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;

  const meses     = req.query.meses ? String(req.query.meses).split(',').filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupNames = parseGroupNames(req.query);
  const groupName = groupNames[0] || null;
  const company = req.query.company || null;
  const partnerBrokerId = scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(String(req.query.months)) || 12, 1), 24));
  const monthRangeFilter = monthList.map((month) => `(
    ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${month}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(month)}-01'
  )`).join(' OR ');

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");
    const columns = (groupNames.length || company || partnerBrokerId) ? await getColumns(wh.id, APPOINTMENTS_TABLE) : [];
    const groupFilter = buildGroupFilter(columns, groupNames);
    const companyFilter = buildCompanyFilter(columns, company);
    const partnerFilter = buildPartnerFilter(columns, partnerBrokerId);

    const rows = await runQuery(wh.id, `
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
    `);

    res.status(200).json({
      total: toInt(rows[0]?.[0]),
      months: monthList,
      source: "atendimento_summarized_gold_live",
      filters: { group_name: groupName, company, partner_broker_id: partnerBrokerId },
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
