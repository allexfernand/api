// api/sessions-evolution.js
// Evolução mensal de sessões finalizadas por Humano e IA (últimos 12 meses).
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
  const jsonCpf = jsonValueExpr(SESSION_VARIABLES_COLUMN, [
    'inputcpfholder', 'cpf_holder', 'cpf',
  ]);
  return normalizeCpfExpr(jsonCpf);
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

    const filters = [monthsSqlFilter];
    if (groupName) {
      filters.push(`UPPER(TRIM(${jsonValueExpr(SESSION_VARIABLES_COLUMN, ['nameEconomicGroup'])})) = UPPER(TRIM('${escape(groupName)}'))`);
    }
    if (company) {
      filters.push(`UPPER(TRIM(${jsonValueExpr(SESSION_VARIABLES_COLUMN, ['nameCompany', 'companyName', 'company', 'nome_cliente', 'NOME_CLIENTE'])})) = UPPER(TRIM('${escape(company)}'))`);
    }
    const where = `WHERE ${filters.join(' AND ')}`;
    const mode = groupName || company ? "variables_json_filter" : "global";
    const rows = await runQuery(wh.id, `
      SELECT
        DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') AS mes,
        CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
        COUNT(*) AS total
      FROM ${SESSION_TABLE}
      ${where}
      GROUP BY
        DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM'),
        CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
      ORDER BY mes
    `);

    const byMesTipo = new Map(rows.map((r) => [
      `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '').toUpperCase()}`,
      toInt(r[2]),
    ]));
    const series = monthList.map((m) => {
      const humano = byMesTipo.get(`${m}|HUMANO`) || 0;
      const ia = byMesTipo.get(`${m}|IA`) || 0;
      return { mes: m, humano, ia, total: humano + ia };
    });

    res.status(200).json({
      months,
      series,
      filters: { group_name: groupName, company, type: typeFilter },
      mode,
      source: "botmaker_session.creation_time",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
