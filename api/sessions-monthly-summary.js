// api/sessions-monthly-summary.js
// Tabela mensal: Mes, Total Sessions, Humano, IA.
// Filtros por grupo/empresa usam vw_beneficiarios + organizations para resolver matriz_id.

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const VW_BENEFICIARIOS = `sanus_databricks.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `sanus_databricks.sanus_prod.organizations`;
const SESSION_DATE_COLUMN = 'creation_time';
const SESSION_VARIABLES_COLUMN = 'variables';

async function dbFetch(path, options = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId, sql) {
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

function escape(s) { return String(s).replace(/'/g, "''"); }
function quoteIdent(s) { return `\`${String(s).replace(/`/g, "``")}\``; }

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

function pickColumn(columns, candidates) {
  const byLower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = byLower.get(candidate.toLowerCase());
    if (column) return column;
  }
  return null;
}

async function getColumns(warehouseId, tableName) {
  const rows = await runQuery(warehouseId, `DESCRIBE TABLE ${tableName}`);
  return rows
    .map((row) => String(getCell(row[0]) || '').trim())
    .filter((column) => column && !column.startsWith('#'));
}

function jsonValueExpr(variablesColumn, keys) {
  const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  const expressions = keys.flatMap((key) => [
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}')), '')`,
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}.value')), '')`,
  ]);
  return `COALESCE(${expressions.join(', ')})`;
}

function sessionTextExpr() {
  return `CAST(${quoteIdent(SESSION_VARIABLES_COLUMN)} AS STRING)`;
}

function economicGroupExpr() {
  const variables = sessionTextExpr();
  return `COALESCE(
    ${jsonValueExpr(SESSION_VARIABLES_COLUMN, ['nameEconomicGroup'])},
    NULLIF(TRIM(regexp_extract(${variables}, '"nameEconomicGroup"\\\\s*:\\\\s*"([^"]+)"', 1)), ''),
    NULLIF(TRIM(regexp_extract(${variables}, '"nameEconomicGroup"\\\\s*:\\\\s*\\\\{[^}]*"value"\\\\s*:\\\\s*"([^"]+)"', 1)), '')
  )`;
}

function companyNameExpr() {
  const variables = sessionTextExpr();
  return `COALESCE(
    ${jsonValueExpr(SESSION_VARIABLES_COLUMN, ['nameCompany', 'companyName', 'company', 'nome_cliente', 'NOME_CLIENTE'])},
    NULLIF(TRIM(regexp_extract(${variables}, '"nameCompany"\\\\s*:\\\\s*"([^"]+)"', 1)), ''),
    NULLIF(TRIM(regexp_extract(${variables}, '"nameCompany"\\\\s*:\\\\s*\\\\{[^}]*"value"\\\\s*:\\\\s*"([^"]+)"', 1)), '')
  )`;
}

function lastNMonthsList(n) {
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

function buildOrgFilter(groupName, company) {
  const conditions = [];
  if (groupName) {
    const g = escape(groupName);
    conditions.push(`(
      o.name = '${g}'
      OR matriz.name = '${g}'
      OR o.matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
    )`);
  }
  if (company) {
    const c = escape(company);
    conditions.push(`(o.name = '${c}' OR b.NOME_CLIENTE = '${c}')`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const meses = req.query.meses ? req.query.meses.split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24));
  const monthInList = `(${monthList.map((m) => `'${m}'`).join(',')})`;
  const monthExpr = `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM')`;
  const hasOrgFilter = Boolean(groupName || company);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const sessionColumns = hasOrgFilter ? await getColumns(wh.id, SESSION_TABLE) : [];
    const botCompanyColumn = hasOrgFilter ? pickColumn(sessionColumns, [
      'bot_company',
      'botCompany',
      'bot company',
      'botcompany',
      'bot_company_name',
      'botCompanyName',
    ]) : null;
    if (hasOrgFilter && !botCompanyColumn) {
      throw new Error(`Coluna bot_company não encontrada em ${SESSION_TABLE}. Colunas disponíveis: ${sessionColumns.slice(0, 80).join(', ')}`);
    }

    const filterValues = [company, groupName].filter(Boolean).map((value) => `'${escape(value)}'`);
    const botCompanyFilter = hasOrgFilter
      ? `AND UPPER(TRIM(CAST(${quoteIdent(botCompanyColumn)} AS STRING))) IN (${filterValues.map((value) => `UPPER(TRIM(${value}))`).join(',')})`
      : '';

    const rows = await runQuery(wh.id, `
        SELECT
          ${monthExpr} AS mes,
          COUNT(*) AS total_sessions,
          SUM(CASE WHEN finished_by IS NOT NULL THEN 1 ELSE 0 END) AS humano,
          SUM(CASE WHEN finished_by IS NULL THEN 1 ELSE 0 END) AS ia
        FROM ${SESSION_TABLE}
        WHERE ${monthExpr} IN ${monthInList}
          ${botCompanyFilter}
        GROUP BY ${monthExpr}
        ORDER BY mes
      `);

    const byMes = new Map(rows.map((r) => [
      String(getCell(r[0]) || ''),
      { total_sessions: toInt(r[1]), humano: toInt(r[2]), ia: toInt(r[3]) },
    ]));
    const items = monthList.map((mes) => {
      const item = byMes.get(mes) || { total_sessions: 0, humano: 0, ia: 0 };
      return { mes, ...item };
    });

    res.status(200).json({
      items,
      filters: { group_name: groupName, company },
      source: "botmaker_session.bot_company",
      mode: hasOrgFilter ? "bot_company_filter" : "global",
      bot_company_column: botCompanyColumn,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
