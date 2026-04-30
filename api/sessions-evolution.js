// api/sessions-evolution.js
// Evolução mensal de sessões (últimos 12 meses).
// - Sem filtro de grupo/empresa: COUNT(*) GROUP BY mês — query rápida.
// - Com filtro: JOIN via CPF (vw_beneficiarios x botmaker_session.variables)
//   com prefiltro de variáveis + BROADCAST + chaves JSON enxutas para tentar
//   manter a query dentro do tempo da função.
// Aceita ?group_name=, ?company=, ?type=, ?months=12.

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SESSION_TABLE       = `hive_metastore.sanus_prod.botmaker_session`;
const VW_BENEFICIARIOS    = `sanus_databricks.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `sanus_databricks.sanus_prod.organizations`;

const SESSION_DATE_COLUMN = 'creation_time';
const SESSION_VARIABLES_COLUMN = 'variables';
const BENEF_CPF_COLUMN = 'CPF';

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

const escape = (s) => String(s).replace(/'/g, "''");
const quoteIdent = (s) => `\`${String(s).replace(/`/g, "``")}\``;

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

function normalizeCpfExpr(expr) {
  const digits = `NULLIF(regexp_replace(TRIM(CAST(${expr} AS STRING)), '[^0-9]', ''), '')`;
  return `CASE
    WHEN ${digits} IS NULL THEN NULL
    WHEN LENGTH(${digits}) < 11 THEN LPAD(${digits}, 11, '0')
    ELSE ${digits}
  END`;
}

function jsonValueExpr(variablesColumn, keys) {
  const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  const expressions = keys.flatMap((key) => [
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}')), '')`,
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}.value')), '')`,
  ]);
  return `COALESCE(${expressions.join(', ')})`;
}

function sessionCpfExpr() {
  return normalizeCpfExpr(jsonValueExpr(SESSION_VARIABLES_COLUMN, ['inputcpfholder', 'cpf_holder', 'cpf']));
}

function variablesPrefilter() {
  const v = `CAST(${quoteIdent(SESSION_VARIABLES_COLUMN)} AS STRING)`;
  return `${v} IS NOT NULL AND (
    ${v} LIKE '%inputcpfholder%' OR
    ${v} LIKE '%cpf_holder%' OR
    ${v} LIKE '%"cpf"%' OR
    ${v} LIKE '%"CPF"%'
  )`;
}

function buildBeneficiaryFilter(groupName, company, typeFilter) {
  const conditions = [];
  if (groupName) {
    const g = escape(groupName);
    conditions.push(`b.ID_EMPRESA IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
      UNION
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
    )`);
  }
  if (company) {
    const c = escape(company);
    conditions.push(`b.ID_EMPRESA IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${c}')`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) != 'TITULAR'`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
  const useCpfJoin = Boolean(groupName || company || typeFilter);

  const monthList = lastNMonthsList(months);
  const monthInList = `(${monthList.map((m) => `'${m}'`).join(',')})`;
  const monthsSqlFilter = `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN ${monthInList}`;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    let rows;
    if (useCpfJoin) {
      const extraFilter = buildBeneficiaryFilter(groupName, company, typeFilter);
      const cpfExpr = sessionCpfExpr();
      const prefilter = variablesPrefilter();
      const sql = `
        WITH filtered_benef AS (
          SELECT DISTINCT ${normalizeCpfExpr(`b.${quoteIdent(BENEF_CPF_COLUMN)}`)} AS cpf
          FROM ${VW_BENEFICIARIOS} b
          WHERE NOME_CLIENTE IS NOT NULL
            ${extraFilter}
            AND ${normalizeCpfExpr(`b.${quoteIdent(BENEF_CPF_COLUMN)}`)} IS NOT NULL
        ),
        sessions_filtered AS (
          SELECT
            DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') AS mes,
            ${quoteIdent(SESSION_VARIABLES_COLUMN)} AS ${quoteIdent(SESSION_VARIABLES_COLUMN)}
          FROM ${SESSION_TABLE}
          WHERE ${monthsSqlFilter}
            AND ${prefilter}
        ),
        sessions_resolved AS (
          SELECT mes, ${cpfExpr} AS cpf
          FROM sessions_filtered
        )
        SELECT /*+ BROADCAST(fb) */
          s.mes AS mes,
          COUNT(*) AS total
        FROM sessions_resolved s
        INNER JOIN filtered_benef fb ON fb.cpf = s.cpf
        WHERE s.cpf IS NOT NULL
        GROUP BY s.mes
        ORDER BY s.mes
      `;
      rows = await runQuery(wh.id, sql);
    } else {
      const sql = `
        SELECT
          DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') AS mes,
          COUNT(*) AS total
        FROM ${SESSION_TABLE}
        WHERE ${monthsSqlFilter}
        GROUP BY DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM')
        ORDER BY mes
      `;
      rows = await runQuery(wh.id, sql);
    }

    const byMes = Object.fromEntries(rows.map((r) => [String(getCell(r[0]) || ''), toInt(r[1])]));
    const series = monthList.map((m) => ({ mes: m, total: byMes[m] || 0 }));

    res.status(200).json({
      months,
      series,
      filters: { group_name: groupName, company, type: typeFilter },
      mode: useCpfJoin ? "cpf_join" : "global",
      source: "botmaker_session.creation_time",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
