// api/sessions.js
const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

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

async function runQueryQuick(warehouseId, sql) {
  const data = await dbFetch("/api/2.0/sql/statements", {
    method: "POST",
    body: JSON.stringify({ warehouse_id: warehouseId, statement: sql, wait_timeout: "25s", on_wait_timeout: "CANCEL" }),
  });
  const state = data.status?.state;
  if (state !== "SUCCEEDED") {
    throw new Error(data.status?.error?.message || "Query excedeu o tempo limite: " + state);
  }
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

function normalizeCpfExpr(expr) {
  const digits = `NULLIF(regexp_replace(TRIM(CAST(${expr} AS STRING)), '[^0-9]', ''), '')`;
  return `CASE
    WHEN ${digits} IS NULL THEN NULL
    WHEN LENGTH(${digits}) < 11 THEN LPAD(${digits}, 11, '0')
    ELSE ${digits}
  END`;
}

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const VW_BENEFICIARIOS = `sanus_databricks.sanus_prod.vw_beneficiarios`;
const ORGANIZATIONS_TABLE = `sanus_databricks.sanus_prod.organizations`;

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

function sessionCpfExpr(variablesColumn) {
  if (!variablesColumn) return null;
  const jsonCpf = jsonValueExpr(variablesColumn, [
    'inputcpfholder', 'cpf_holder', 'cpf',
  ]);
  return normalizeCpfExpr(jsonCpf);
}

function sessionVariablesPrefilter(variablesColumn) {
  if (!variablesColumn) return null;
  const v = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  return `${v} IS NOT NULL AND (
    ${v} LIKE '%inputcpfholder%' OR
    ${v} LIKE '%cpf_holder%' OR
    ${v} LIKE '%"cpf"%' OR
    ${v} LIKE '%"CPF"%'
  )`;
}

function orgIdsSubquery(groupName, company) {
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

function orgNamesSubquery(groupName, company) {
  if (company) {
    return `(SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${escape(company)}')`;
  }
  const g = escape(groupName);
  return `(
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
    UNION
    SELECT UPPER(TRIM(name)) FROM ${ORGANIZATIONS_TABLE}
    WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
  )`;
}

function textEqualsExpr(expr, value) {
  return `UPPER(TRIM(CAST(${expr} AS STRING))) = UPPER(TRIM('${escape(value)}'))`;
}

function textInExpr(expr, subquery) {
  return `UPPER(TRIM(CAST(${expr} AS STRING))) IN ${subquery}`;
}

function buildExtraFilter(groupName, company, typeFilter) {
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const meses = req.query.meses ? req.query.meses.split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const useCompanyFilterSum = Boolean(groupName || company || typeFilter);
  const extraFilter = buildExtraFilter(groupName, company, typeFilter);

  const SESSION_DATE_COLUMN = 'creation_time';

  const buildSessionDateFilter = (mesesArr) => mesesArr.length > 0
    ? `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${mesesArr.map((m) => `'${m}'`).join(',')})`
    : null;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const sessionDateFilter = buildSessionDateFilter(meses);
    const finishersDateFilter = sessionDateFilter;

    // Card 1 — Total
    // - Com filtro de grupo/empresa: soma beneficiários da view (rápido).
    // - Sem filtro: COUNT direto no botmaker_session, opcionalmente filtrado por mês.
    const totalPromise = useCompanyFilterSum
      ? runQuery(wh.id, `
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT NOME_CLIENTE) AS empresas
        FROM ${VW_BENEFICIARIOS} b
        WHERE NOME_CLIENTE IS NOT NULL
          ${extraFilter}
      `)
      : runQuery(wh.id, `
        SELECT COUNT(*) AS total, 0 AS empresas
        FROM ${SESSION_TABLE}
        ${sessionDateFilter ? `WHERE ${sessionDateFilter}` : ''}
      `);

    // Card 2 — Sessões finalizadas por (Humano vs IA)
    // Usa o mesmo período do Card 1. Se não houver período selecionado, usa o
    // período completo. Quando houver filtros da tela, aplica via CPF.
    const finishersPromise = useCompanyFilterSum
      ? runQueryQuick(wh.id, `
        WITH filtered_cpfs AS (
          SELECT DISTINCT ${normalizeCpfExpr(`b.${quoteIdent('CPF')}`)} AS cpf
          FROM ${VW_BENEFICIARIOS} b
          WHERE NOME_CLIENTE IS NOT NULL
            ${extraFilter}
            AND ${normalizeCpfExpr(`b.${quoteIdent('CPF')}`)} IS NOT NULL
        ),
        sessions_filtered AS (
          SELECT finished_by, ${quoteIdent('variables')} AS variables
          FROM ${SESSION_TABLE}
          ${finishersDateFilter ? `WHERE ${finishersDateFilter} AND ${sessionVariablesPrefilter('variables')}` : `WHERE ${sessionVariablesPrefilter('variables')}`}
        ),
        sessions_resolved AS (
          SELECT finished_by, ${sessionCpfExpr('variables')} AS cpf
          FROM sessions_filtered
        )
        SELECT /*+ BROADCAST(filtered_cpfs) */
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM sessions_resolved s
        INNER JOIN filtered_cpfs fc ON fc.cpf = s.cpf
        WHERE s.cpf IS NOT NULL
        GROUP BY CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
      `)
      : runQuery(wh.id, `
        SELECT
          CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE}
        ${finishersDateFilter ? `WHERE ${finishersDateFilter}` : ''}
        GROUP BY CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
      `);

    const [totalSettled, finishersSettled] = await Promise.allSettled([totalPromise, finishersPromise]);
    if (totalSettled.status !== 'fulfilled') {
      throw totalSettled.reason instanceof Error ? totalSettled.reason : new Error(String(totalSettled.reason));
    }
    const rows = totalSettled.value;
    const row = rows[0] || [];
    const total = toInt(row[0]);

    const finishersError = finishersSettled.status === 'rejected'
      ? (finishersSettled.reason instanceof Error ? finishersSettled.reason.message : String(finishersSettled.reason))
      : null;
    const finisherRows = finishersSettled.status === 'fulfilled' ? finishersSettled.value : [];
    const rawFinishers = finisherRows.map((r) => ({
      tipo: String(getCell(r[0]) || "—"),
      total: toInt(r[1]),
    }));
    const rawFinishersTotal = rawFinishers.reduce((acc, item) => acc + item.total, 0);
    const scaledFinishers = rawFinishersTotal > 0
      ? rawFinishers.map((item) => ({
          ...item,
          total: Math.round((item.total / rawFinishersTotal) * total),
          raw_total: item.total,
        }))
      : [];
    if (scaledFinishers.length > 0) {
      const allocated = scaledFinishers.slice(0, -1).reduce((acc, item) => acc + item.total, 0);
      scaledFinishers[scaledFinishers.length - 1].total = Math.max(total - allocated, 0);
    }
    const finishers = useCompanyFilterSum && rawFinishersTotal > 0
      ? scaledFinishers
      : rawFinishers;

    res.status(200).json({
      total,
      empresas: toInt(row[1]),
      finishers,
      finishers_raw_total: rawFinishersTotal,
      finishers_scaled_to_total: useCompanyFilterSum && rawFinishersTotal > 0,
      finishers_filter_applied: { period: true, organization: true, type: true },
      finishers_fallback_month: null,
      finishers_error: finishersError,
      source: useCompanyFilterSum ? "company_filter_sum" : "botmaker_session",
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
