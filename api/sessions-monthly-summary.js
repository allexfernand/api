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

    let rows;
    if (hasOrgFilter) {
      const sessionOrgFilters = [];
      if (groupName) {
        const g = escape(groupName);
        sessionOrgFilters.push(`(
          s.economic_group IN (SELECT economic_group FROM filtered_orgs)
          OR (
            s.variables_text LIKE '%nameEconomicGroup%'
            AND UPPER(s.variables_text) LIKE UPPER('%${g}%')
          )
        )`);
      }
      if (company) {
        const c = escape(company);
        sessionOrgFilters.push(`(
          s.company_name IN (SELECT company_name FROM filtered_orgs)
          OR s.company_name IN (SELECT beneficiary_company_name FROM filtered_orgs)
          OR (
            (s.variables_text LIKE '%nameCompany%' OR s.variables_text LIKE '%companyName%' OR s.variables_text LIKE '%company%')
            AND UPPER(s.variables_text) LIKE UPPER('%${c}%')
          )
        )`);
      }
      const sessionOrgWhere = sessionOrgFilters.length ? `WHERE ${sessionOrgFilters.join(' AND ')}` : '';
      rows = await runQuery(wh.id, `
        WITH filtered_orgs AS (
          SELECT DISTINCT
            UPPER(TRIM(COALESCE(matriz.name, o.name))) AS economic_group,
            UPPER(TRIM(o.name)) AS company_name,
            UPPER(TRIM(b.NOME_CLIENTE)) AS beneficiary_company_name
          FROM ${VW_BENEFICIARIOS} b
          INNER JOIN ${ORGANIZATIONS_TABLE} o ON CAST(b.ID_EMPRESA AS STRING) = CAST(o.id AS STRING)
          LEFT JOIN ${ORGANIZATIONS_TABLE} matriz ON CAST(o.matriz_id AS STRING) = CAST(matriz.id AS STRING)
          WHERE b.NOME_CLIENTE IS NOT NULL
            ${buildOrgFilter(groupName, company)}
        ),
        sessions_resolved AS (
          SELECT
            ${monthExpr} AS mes,
            finished_by,
            UPPER(TRIM(${economicGroupExpr()})) AS economic_group,
            UPPER(TRIM(${companyNameExpr()})) AS company_name,
            CAST(${quoteIdent(SESSION_VARIABLES_COLUMN)} AS STRING) AS variables_text
          FROM ${SESSION_TABLE}
          WHERE ${monthExpr} IN ${monthInList}
        )
        SELECT
          s.mes,
          COUNT(*) AS total_sessions,
          SUM(CASE WHEN s.finished_by IS NOT NULL THEN 1 ELSE 0 END) AS humano,
          SUM(CASE WHEN s.finished_by IS NULL THEN 1 ELSE 0 END) AS ia
        FROM sessions_resolved s
        ${sessionOrgWhere}
        GROUP BY s.mes
        ORDER BY s.mes
      `);
    } else {
      rows = await runQuery(wh.id, `
        SELECT
          ${monthExpr} AS mes,
          COUNT(*) AS total_sessions,
          SUM(CASE WHEN finished_by IS NOT NULL THEN 1 ELSE 0 END) AS humano,
          SUM(CASE WHEN finished_by IS NULL THEN 1 ELSE 0 END) AS ia
        FROM ${SESSION_TABLE}
        WHERE ${monthExpr} IN ${monthInList}
        GROUP BY ${monthExpr}
        ORDER BY mes
      `);
    }

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
      source: "vw_beneficiarios.ID_EMPRESA -> organizations.matriz_id + botmaker_session.variables",
      mode: hasOrgFilter ? "organization_matrix_filter" : "global",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
