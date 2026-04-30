// api/sessions-total-evolution.js
// Evolução mensal do total de sessões, baseada em creation_time.
// Sem filtro: COUNT(*) mensal global.
// Com grupo/empresa: cruza CPFs da vw_beneficiarios com botmaker_session.variables.

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

function quoteIdent(s) { return `\`${String(s).replace(/`/g, "``")}\``; }
function escape(s) { return String(s).replace(/'/g, "''"); }

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

function pickBeneficiaryCpfColumn(columns) {
  return pickColumn(columns, [
    'cpf',
    'CPF',
    'nr_cpf',
    'NR_CPF',
    'num_cpf',
    'NUM_CPF',
    'cpf_beneficiario',
    'CPF_BENEFICIARIO',
    'cpf_benef',
    'CPF_BENEF',
    'cpf_titular',
    'CPF_TITULAR',
    'cpf_holder',
    'CPF_HOLDER',
    'document',
    'DOCUMENT',
    'documento',
    'DOCUMENTO',
    'document_number',
    'DOCUMENT_NUMBER',
    'numero_documento',
    'NUMERO_DOCUMENTO',
    'nro_documento',
    'NRO_DOCUMENTO',
  ]);
}

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
  const variables = `CAST(${quoteIdent(SESSION_VARIABLES_COLUMN)} AS STRING)`;
  const jsonCpf = jsonValueExpr(SESSION_VARIABLES_COLUMN, [
    'inputcpfholder',
    'inputCpfHolder',
    'input_cpf_holder',
    'inputCpf',
    'input_cpf',
    'cpf_holder',
    'cpfHolder',
    'cpf',
    'CPF',
    'document',
    'documento',
    'document_number',
    'documentNumber',
    'cpf_beneficiario',
    'cpfBeneficiario',
  ]);
  const regexCpf = `NULLIF(regexp_extract(${variables}, '([0-9]{3}[. -]?[0-9]{3}[. -]?[0-9]{3}[. -]?[0-9]{2})', 1), '')`;
  return normalizeCpfExpr(`COALESCE(${jsonCpf}, ${regexCpf})`);
}

function variablesPrefilter() {
  const v = `CAST(${quoteIdent(SESSION_VARIABLES_COLUMN)} AS STRING)`;
  return `${v} IS NOT NULL AND (
    ${v} LIKE '%inputcpfholder%' OR
    ${v} LIKE '%inputCpfHolder%' OR
    ${v} LIKE '%input_cpf_holder%' OR
    ${v} LIKE '%inputCpf%' OR
    ${v} LIKE '%input_cpf%' OR
    ${v} LIKE '%cpf_holder%' OR
    ${v} LIKE '%cpfHolder%' OR
    ${v} LIKE '%"cpf"%' OR
    ${v} LIKE '%"CPF"%' OR
    ${v} LIKE '%document%' OR
    ${v} LIKE '%documento%' OR
    ${v} LIKE '%cpf_beneficiario%' OR
    ${v} RLIKE '[0-9]{3}[. -]?[0-9]{3}[. -]?[0-9]{3}[. -]?[0-9]{2}'
  )`;
}

function buildBeneficiaryFilter(groupName, company) {
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
  const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
  const useCpfJoin = Boolean(groupName || company);
  const monthList = lastNMonthsList(months);
  const monthInList = `(${monthList.map((m) => `'${m}'`).join(',')})`;
  const monthExpr = `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM')`;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    let rows;
    let beneficiaryCpfColumn = null;
    if (useCpfJoin) {
      const beneficiaryColumns = await getColumns(wh.id, VW_BENEFICIARIOS);
      beneficiaryCpfColumn = pickBeneficiaryCpfColumn(beneficiaryColumns);
      if (!beneficiaryCpfColumn) {
        throw new Error(`Coluna de CPF/documento não encontrada em ${VW_BENEFICIARIOS}. Colunas disponíveis: ${beneficiaryColumns.slice(0, 80).join(', ')}`);
      }
      const extraFilter = buildBeneficiaryFilter(groupName, company);
      const cpfExpr = sessionCpfExpr();
      const prefilter = variablesPrefilter();
      rows = await runQuery(wh.id, `
        WITH filtered_benef AS (
          SELECT DISTINCT ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} AS cpf
          FROM ${VW_BENEFICIARIOS} b
          WHERE NOME_CLIENTE IS NOT NULL
            ${extraFilter}
            AND ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} IS NOT NULL
        ),
        sessions_filtered AS (
          SELECT
            ${monthExpr} AS mes,
            ${quoteIdent(SESSION_VARIABLES_COLUMN)} AS ${quoteIdent(SESSION_VARIABLES_COLUMN)}
          FROM ${SESSION_TABLE}
          WHERE ${monthExpr} IN ${monthInList}
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
      `);
    } else {
      rows = await runQuery(wh.id, `
        SELECT
          ${monthExpr} AS mes,
          COUNT(*) AS total
        FROM ${SESSION_TABLE}
        WHERE ${monthExpr} IN ${monthInList}
        GROUP BY ${monthExpr}
        ORDER BY mes
      `);
    }

    const byMes = Object.fromEntries(rows.map((r) => [String(getCell(r[0]) || ''), toInt(r[1])]));
    const series = monthList.map((m) => ({ mes: m, total: byMes[m] || 0 }));
    const matchedTotal = series.reduce((acc, item) => acc + item.total, 0);

    res.status(200).json({
      months,
      series,
      source: "botmaker_session.creation_time",
      mode: useCpfJoin ? "cpf_join_count_by_month" : "global_count_by_month",
      filters: { group_name: groupName, company },
      cpf_column: beneficiaryCpfColumn,
      matched_total: matchedTotal,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
