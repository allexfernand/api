// api/sessions-evolution.ts
// Evolução mensal de sessões finalizadas por Humano e IA (últimos 12 meses).
// - Sem filtro de grupo/empresa: COUNT(*) GROUP BY mês — query rápida.
// - Com filtro: JOIN por botmaker_session.organization_id x organizations.id.
// Aceita ?group_name=, ?company=, ?type=, ?months=12.
import { requireBasicAuth } from "../lib/basic-auth";

declare const process: { env: Record<string, string | undefined> };

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SESSION_TABLE       = `hive_metastore.sanus_prod.botmaker_session`;
const MESSAGE_TABLE       = `hive_metastore.sanus_prod.botmaker_message`;
const DASHBOARD_SESSIONS_TABLE = `hive_metastore.sanus_prod.dashboard_sessions_base_gold`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

const SESSION_DATE_COLUMN = 'creation_time';

function dashboardSessionsInlineSql() {
  return `(
    SELECT
      CAST(s.${quoteIdent('session_id')} AS STRING) AS session_id,
      try_cast(s.${quoteIdent('creation_time')} AS TIMESTAMP) AS creation_ts,
      DATE_FORMAT(try_cast(s.${quoteIdent('creation_time')} AS TIMESTAMP), 'yyyy-MM') AS mes,
      DATE_FORMAT(try_cast(s.${quoteIdent('creation_time')} AS TIMESTAMP), 'yyyy-MM-dd') AS dia,
      CAST(s.${quoteIdent('organization_id')} AS STRING) AS organization_id,
      NULLIF(TRIM(CAST(o.${quoteIdent('name')} AS STRING)), '') AS organization_name,
      CASE
        WHEN s.${quoteIdent('economic_group_name')} IS NULL OR TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING)) = ''
        THEN 'Nulos'
        ELSE TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING))
      END AS economic_group_name,
      COALESCE(
        NULLIF(TRIM(CAST(o.${quoteIdent('name_economic_group')} AS STRING)), ''),
        NULLIF(TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING)), ''),
        'Nulos'
      ) AS economic_group_canonical,
      CASE
        WHEN s.${quoteIdent('variables')}['typification'] IS NULL THEN '(NULO)'
        WHEN TRIM(CAST(s.${quoteIdent('variables')}['typification'] AS STRING)) = '' THEN '(VAZIO/BRANCO)'
        ELSE TRIM(CAST(s.${quoteIdent('variables')}['typification'] AS STRING))
      END AS tipificacao,
      CASE WHEN s.${quoteIdent('finished_by')} IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_finished_by,
      CASE WHEN s.${quoteIdent('finished_by')} IS NOT NULL THEN 1 ELSE 0 END AS teve_humano_agent,
      CASE WHEN s.${quoteIdent('finished_by')} IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento_agent,
      COALESCE(
        CASE
          WHEN NULLIF(TRIM(CAST(COALESCE(
            s.${quoteIdent('variables')}['beneficiary_id'],
            s.${quoteIdent('variables')}['beneficiaryId'],
            s.${quoteIdent('variables')}['beneficiario_id'],
            s.${quoteIdent('variables')}['id_beneficiario'],
            s.${quoteIdent('variables')}['user_id'],
            s.${quoteIdent('variables')}['userId'],
            s.${quoteIdent('variables')}['customer_id'],
            s.${quoteIdent('variables')}['customerId']
          ) AS STRING)), '') IS NOT NULL
          THEN CONCAT('beneficiary:', NULLIF(TRIM(CAST(COALESCE(
            s.${quoteIdent('variables')}['beneficiary_id'],
            s.${quoteIdent('variables')}['beneficiaryId'],
            s.${quoteIdent('variables')}['beneficiario_id'],
            s.${quoteIdent('variables')}['id_beneficiario'],
            s.${quoteIdent('variables')}['user_id'],
            s.${quoteIdent('variables')}['userId'],
            s.${quoteIdent('variables')}['customer_id'],
            s.${quoteIdent('variables')}['customerId']
          ) AS STRING)), ''))
        END,
        CASE
          WHEN NULLIF(REGEXP_REPLACE(CAST(COALESCE(
            s.${quoteIdent('variables')}['cpf'],
            s.${quoteIdent('variables')}['CPF'],
            s.${quoteIdent('variables')}['document'],
            s.${quoteIdent('variables')}['documento'],
            s.${quoteIdent('variables')}['cpf_cnpj'],
            s.${quoteIdent('variables')}['document_number'],
            s.${quoteIdent('variables')}['beneficiary_cpf'],
            s.${quoteIdent('variables')}['cpf_beneficiario'],
            s.${quoteIdent('variables')}['cpf_beneficiary']
          ) AS STRING), '[^0-9]', ''), '') IS NOT NULL
          THEN CONCAT('cpf:', NULLIF(REGEXP_REPLACE(CAST(COALESCE(
            s.${quoteIdent('variables')}['cpf'],
            s.${quoteIdent('variables')}['CPF'],
            s.${quoteIdent('variables')}['document'],
            s.${quoteIdent('variables')}['documento'],
            s.${quoteIdent('variables')}['cpf_cnpj'],
            s.${quoteIdent('variables')}['document_number'],
            s.${quoteIdent('variables')}['beneficiary_cpf'],
            s.${quoteIdent('variables')}['cpf_beneficiario'],
            s.${quoteIdent('variables')}['cpf_beneficiary']
          ) AS STRING), '[^0-9]', ''), ''))
        END
      ) AS beneficiary_key
    FROM ${SESSION_TABLE} s
    LEFT JOIN ${ORGANIZATIONS_TABLE} o
      ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)
    WHERE s.${quoteIdent('creation_time')} IS NOT NULL
  )`;
}

type DbOptions = RequestInit & { headers?: Record<string, string> };
type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
type DatabricksRow = DatabricksCell[];
type ApiRequest = { method?: string; query: Record<string, any> };
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

const escape = (s: unknown) => String(s).replace(/'/g, "''");
const quoteIdent = (s: unknown) => `\`${String(s).replace(/`/g, "``")}\``;
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

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };

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

let sessionColumnsCache: string[] | null = null;
async function getSessionColumns(warehouseId: string) {
  if (!sessionColumnsCache) {
    sessionColumnsCache = await getColumns(warehouseId, SESSION_TABLE);
  }
  return sessionColumnsCache;
}

type DashboardSessionsCache = { warehouseId: string; sql: string; usingGold: boolean };
let dashboardSessionsTableCache: DashboardSessionsCache | null = null;

async function resolveDashboardSessionsTable(warehouseId: string) {
  if (dashboardSessionsTableCache && dashboardSessionsTableCache.warehouseId === warehouseId) {
    return dashboardSessionsTableCache.sql;
  }
  try {
    await runQuery(warehouseId, `SELECT 1 FROM ${DASHBOARD_SESSIONS_TABLE} LIMIT 0`);
    dashboardSessionsTableCache = { warehouseId, sql: DASHBOARD_SESSIONS_TABLE, usingGold: true };
  } catch {
    dashboardSessionsTableCache = { warehouseId, sql: dashboardSessionsInlineSql(), usingGold: false };
  }
  return dashboardSessionsTableCache.sql;
}

function uniqueBeneficiaryExpr(columns: string[]) {
  const directCpfColumn = pickColumn(columns, [
    'cpf', 'CPF', 'document', 'documento', 'cpf_cnpj', 'cpfCnpj',
    'document_number', 'numero_documento', 'beneficiary_cpf', 'beneficiario_cpf',
    'cpf_beneficiario', 'cpf_beneficiary', 'cpf_titular',
  ]);
  const directBeneficiaryColumn = pickColumn(columns, [
    'beneficiary_id', 'beneficiario_id', 'id_beneficiario', 'idBeneficiario',
    'beneficiaryId', 'user_id', 'userId', 'customer_id', 'customerId',
    'patient_id', 'patientId', 'member_id', 'memberId', 'health_user_id',
    'person_id', 'personId', 'individual_id', 'individualId', 'client_id',
    'clientId', 'cliente_id', 'id_cliente', 'id_usuario', 'usuario_id',
    'id_paciente', 'paciente_id', 'beneficiary_external_id',
  ]);
  const cpfExpressions = [];
  const idExpressions = [];
  if (directCpfColumn) {
    cpfExpressions.push(`CAST(s.${quoteIdent(directCpfColumn)} AS STRING)`);
  }
  if (directBeneficiaryColumn) {
    idExpressions.push(`CAST(s.${quoteIdent(directBeneficiaryColumn)} AS STRING)`);
  }
  if (columns.some((column) => column.toLowerCase() === 'variables')) {
    cpfExpressions.push(
      `CAST(s.${quoteIdent('variables')}['cpf'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['CPF'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['document'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['documento'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cpf_cnpj'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['document_number'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiary_cpf'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cpf_beneficiario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cpf_beneficiary'] AS STRING)`
    );
    idExpressions.push(
      `CAST(s.${quoteIdent('variables')}['beneficiary_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiaryId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiario_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['id_beneficiario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['idBeneficiario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['user_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['userId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['customer_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['customerId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['patient_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['patientId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['member_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['memberId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['person_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['personId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['individual_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['individualId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['client_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['clientId'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['cliente_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['id_cliente'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['id_usuario'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['usuario_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['id_paciente'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['paciente_id'] AS STRING)`,
      `CAST(s.${quoteIdent('variables')}['beneficiary_external_id'] AS STRING)`
    );
  }
  if (!cpfExpressions.length && !idExpressions.length) return null;
  const cpfExpr = cpfExpressions.length
    ? `NULLIF(regexp_replace(COALESCE(${cpfExpressions.join(', ')}), '[^0-9]', ''), '')`
    : "CAST(NULL AS STRING)";
  const idExpr = idExpressions.length
    ? `NULLIF(TRIM(CAST(COALESCE(${idExpressions.join(', ')}) AS STRING)), '')`
    : "CAST(NULL AS STRING)";
  return `COALESCE(CASE WHEN ${idExpr} IS NOT NULL THEN CONCAT('beneficiary:', ${idExpr}) END, CASE WHEN ${cpfExpr} IS NOT NULL THEN CONCAT('cpf:', ${cpfExpr}) END)`;
}

function orgIdsSubquery(groupName: unknown, company: unknown) {
  if (company) {
    return `(SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${escape(company)}')`;
  }
  const g = escape(groupName);
  return `(
    SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
    UNION
    SELECT CAST(id AS STRING) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
  )`;
}

function economicGroupNameCondition(groupName: unknown, tableAlias = 's') {
  const g = escape(groupName);
  const col = `${tableAlias}.${quoteIdent('economic_group_canonical')}`;
  const canonicalLookup = `(
    SELECT NULLIF(TRIM(CAST(name_economic_group AS STRING)), '')
    FROM ${ORGANIZATIONS_TABLE}
    WHERE active = true AND UPPER(TRIM(CAST(name AS STRING))) = UPPER(TRIM('${g}'))
    LIMIT 1
  )`;
  return `UPPER(TRIM(CAST(${col} AS STRING))) = UPPER(TRIM(COALESCE(${canonicalLookup}, '${g}')))`;
}

function economicGroupNamesCondition(groupNames: string[], tableAlias = 's') {
  const names = groupNames.filter(Boolean);
  if (!names.length) return null;
  if (names.length === 1) return economicGroupNameCondition(names[0], tableAlias);
  const col = `${tableAlias}.${quoteIdent('economic_group_canonical')}`;
  const nameList = names.map((name) => `UPPER(TRIM('${escape(name)}'))`).join(',');
  const literalRows = names.map((name, index) => `${index ? 'UNION ALL ' : ''}SELECT UPPER(TRIM('${escape(name)}')) AS group_name`).join('\n    ');
  return `UPPER(TRIM(CAST(${col} AS STRING))) IN (
    SELECT UPPER(TRIM(CAST(COALESCE(NULLIF(TRIM(CAST(name_economic_group AS STRING)), ''), name) AS STRING)))
    FROM ${ORGANIZATIONS_TABLE}
    WHERE active = true AND UPPER(TRIM(CAST(name AS STRING))) IN (${nameList})
    UNION
    ${literalRows}
  )`;
}

function partnerBrokerCondition(partnerBrokerId: unknown, tableAlias = 's') {
  const id = String(partnerBrokerId || '').trim();
  if (!id) return null;
  return `CAST(${tableAlias}.${quoteIdent('organization_id')} AS STRING) IN (
    SELECT CAST(opb.organization_id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(id)}'
      AND opb.deleted_at IS NULL
    UNION
    SELECT CAST(child.id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(id)}'
      AND opb.deleted_at IS NULL
  )`;
}

function lastNMonthsList(n: number, includeCurrentMonth = true) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  if (!includeCurrentMonth) d.setUTCMonth(d.getUTCMonth() - 1);
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

  const groupNames = parseGroupNames(req.query);
  const groupName = groupNames[0] || null;
  const company = req.query.company || null;
  const partnerBrokerId = req.query.partner_broker_id || null;
  const typeFilter = req.query.type || null;
  const granularity = req.query.granularity || 'month';
  const dayMonth = req.query.mes && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : null;
  const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
  const includeBeneficiaries = String(req.query.include_beneficiaries || '') === '1';
  const onlyBeneficiaries = String(req.query.only_beneficiaries || '') === '1';
  const hasOrgFilter = Boolean(groupNames.length || company || partnerBrokerId);

  const monthList = lastNMonthsList(months);
  const fullMonthScopes = {
    last_1_month: lastNMonthsList(1, false),
    last_3_months: lastNMonthsList(3, false),
    last_6_months: lastNMonthsList(6, false),
    last_12_months: lastNMonthsList(12, false),
  };
  const monthInList = `(${monthList.map((m) => `'${m}'`).join(',')})`;
  const monthsSqlFilter = `s.${quoteIdent('mes')} IN ${monthInList}`;
  const selectedDayMonth = dayMonth || monthList[monthList.length - 1];
  const daySqlFilter = `s.${quoteIdent('dia')} >= '${selectedDayMonth}-01'
    AND s.${quoteIdent('dia')} < '${nextMonth(selectedDayMonth)}-01'`;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");
    const dashboardSessionsTable = await resolveDashboardSessionsTable(wh.id);

    const filters = [granularity === 'day' ? daySqlFilter : monthsSqlFilter];
    const orgFilters = [
      company ? `s.${quoteIdent('organization_name')} = '${escape(company)}'` : economicGroupNamesCondition(groupNames, 's'),
      partnerBrokerCondition(partnerBrokerId, 's'),
    ].filter(Boolean);
    filters.push(...orgFilters);
    const fromSql = `${dashboardSessionsTable} s`;
    const where = `WHERE ${filters.join(' AND ')}`;
    const mode = hasOrgFilter
      ? (partnerBrokerId ? "partner_broker" : (company ? "organization_subquery" : "economic_group_name"))
      : "global";
    if (granularity === 'day') {
      const rows = await runQuery(wh.id, `
        SELECT
          s.${quoteIdent('dia')} AS dia,
          s.${quoteIdent('tipo_atendimento_agent')} AS tipo_atendimento,
          COUNT(*) AS total
        FROM ${fromSql}
        ${where}
        GROUP BY
          s.${quoteIdent('dia')},
          s.${quoteIdent('tipo_atendimento_agent')}
        ORDER BY dia
      `);

      const byDiaTipo = new Map(rows.map((r) => [
        `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '').toUpperCase()}`,
        toInt(r[2]),
      ]));
      const days = [];
      const start = new Date(`${selectedDayMonth}-01T00:00:00Z`);
      const end = new Date(`${nextMonth(selectedDayMonth)}-01T00:00:00Z`);
      for (const d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
      }
      const series = days.map((day) => {
        const humano = byDiaTipo.get(`${day}|HUMANO`) || 0;
        const ia = byDiaTipo.get(`${day}|IA`) || 0;
        return { dia: day, humano, ia, total: humano + ia };
      });

      return res.status(200).json({
        granularity: "day",
        month: selectedDayMonth,
        series,
        filters: { group_name: groupName, company, type: typeFilter, partner_broker_id: partnerBrokerId },
        mode,
        source: "botmaker_session.inline",
      });
    }

    const [rows, beneficiaryRows] = await Promise.all([
      onlyBeneficiaries ? Promise.resolve([]) : runQuery(wh.id, `
      WITH scoped_sessions AS (
        SELECT
          s.${quoteIdent('mes')} AS mes,
          s.${quoteIdent('tipo_atendimento_agent')} AS tipo_atendimento
        FROM ${fromSql}
        ${where}
      )
      SELECT
        ss.mes,
        ss.tipo_atendimento,
        COUNT(*) AS total
      FROM scoped_sessions ss
      GROUP BY
        ss.mes,
        ss.tipo_atendimento
      ORDER BY ss.mes
    `),
      includeBeneficiaries ? runQuery(wh.id, `
      WITH beneficiary_base AS (
        SELECT
          s.${quoteIdent('mes')} AS mes,
          s.${quoteIdent('beneficiary_key')} AS beneficiary_key
        FROM ${fromSql}
        ${where}
          AND s.${quoteIdent('beneficiary_key')} IS NOT NULL
      )
      SELECT
        mes,
        COUNT(DISTINCT beneficiary_key) AS unique_beneficiaries
      FROM beneficiary_base
      GROUP BY mes
      UNION ALL
      SELECT '__last_1_month', COUNT(DISTINCT CASE WHEN mes IN (${fullMonthScopes.last_1_month.map((month) => `'${month}'`).join(',')}) THEN beneficiary_key END)
      FROM beneficiary_base
      UNION ALL
      SELECT '__last_3_months', COUNT(DISTINCT CASE WHEN mes IN (${fullMonthScopes.last_3_months.map((month) => `'${month}'`).join(',')}) THEN beneficiary_key END)
      FROM beneficiary_base
      UNION ALL
      SELECT '__last_6_months', COUNT(DISTINCT CASE WHEN mes IN (${fullMonthScopes.last_6_months.map((month) => `'${month}'`).join(',')}) THEN beneficiary_key END)
      FROM beneficiary_base
      UNION ALL
      SELECT '__last_12_months', COUNT(DISTINCT beneficiary_key)
      FROM beneficiary_base
    `) : Promise.resolve([]),
    ]);

    const byMesTipo = new Map(rows.map((r) => [
      `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '').toUpperCase()}`,
      toInt(r[2]),
    ]));
    const beneficiariesByMes = new Map();
    const utilization = {
      last_1_month: 0,
      last_3_months: 0,
      last_6_months: 0,
      last_12_months: 0,
    };
    beneficiaryRows.forEach((row) => {
      const key = String(getCell(row[0]) || "");
      const value = toInt(row[1]);
      if (key === "__last_1_month") utilization.last_1_month = value;
      else if (key === "__last_3_months") utilization.last_3_months = value;
      else if (key === "__last_6_months") utilization.last_6_months = value;
      else if (key === "__last_12_months") utilization.last_12_months = value;
      else beneficiariesByMes.set(key, value);
    });
    const series = monthList.map((m) => {
      const humano = byMesTipo.get(`${m}|HUMANO`) || 0;
      const ia = byMesTipo.get(`${m}|IA`) || 0;
      const uniqueBeneficiaries = beneficiariesByMes.get(m) || 0;
      return { mes: m, humano, ia, total: humano + ia, unique_cpfs: uniqueBeneficiaries, unique_beneficiaries: uniqueBeneficiaries };
    });

    res.status(200).json({
      months,
      series,
      utilization,
      utilization_periods: fullMonthScopes,
      beneficiaries_included: Boolean(includeBeneficiaries),
      filters: { group_name: groupName, company, type: typeFilter, partner_broker_id: partnerBrokerId },
      mode,
      source: "botmaker_session.inline",
      cpf_source: includeBeneficiaries ? "botmaker_session.variables" : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
