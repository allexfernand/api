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

function jsonValueExpr(variablesColumn, keys) {
  const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;
  const expressions = keys.flatMap((key) => [
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}')), '')`,
    `NULLIF(TRIM(get_json_object(${variables}, '$.${key}.value')), '')`,
  ]);
  return `COALESCE(${expressions.join(', ')})`;
}

function buildFilters({ meses, groupName, company, typeFilter, hasSessionDate }) {
  const conditions = [];
  if (meses.length > 0 && hasSessionDate) {
    conditions.push(`DATE_FORMAT(session_at, 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`);
  }
  if (groupName) {
    const group = escape(groupName);
    conditions.push(`(
      UPPER(TRIM(COALESCE(grupo_economico, ''))) LIKE UPPER('%${group}%')
      OR UPPER(TRIM(COALESCE(empresa, ''))) IN (
        SELECT UPPER(TRIM(name))
        FROM sanus_databricks.sanus_prod.organizations
        WHERE name = '${group}'
          OR matriz_id = (
            SELECT id
            FROM sanus_databricks.sanus_prod.organizations
            WHERE name = '${group}'
            LIMIT 1
          )
      )
    )`);
  }
  if (company) {
    conditions.push(`UPPER(TRIM(COALESCE(empresa, ''))) = UPPER(TRIM('${escape(company)}'))`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(tipo_beneficiario, ''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(tipo_beneficiario, ''))) != 'TITULAR'`);
  }
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const describeRows = await runQuery(wh.id, `DESCRIBE TABLE hive_metastore.sanus_prod.botmaker_session`);
    const columns = describeRows
      .map((row) => String(getCell(row[0]) || '').trim())
      .filter((column) => column && !column.startsWith('#'));

    const variablesColumn = pickColumn(columns, ['variables']);
    if (!variablesColumn) throw new Error("Coluna variables não encontrada em botmaker_session.");

    const sessionDateColumn = pickColumn(columns, [
      'created_at',
      'createdAt',
      'creation_time',
      'creationTime',
      'session_created_at',
      'session_creation_time',
      'started_at',
      'start_time',
      'startTime',
      'timestamp',
      'data_criacao',
    ]);
    const sessionAtExpr = sessionDateColumn
      ? `try_cast(${quoteIdent(sessionDateColumn)} AS TIMESTAMP)`
      : `CAST(NULL AS TIMESTAMP)`;

    const grupoExpr = jsonValueExpr(variablesColumn, [
      'grupo_economico',
      'grupoEconomico',
      'economic_group',
      'economicGroup',
      'group_name',
      'nome_grupo',
      'nomeGrupo',
      'NOME_GRUPO_ECONOMICO',
    ]);
    const empresaExpr = jsonValueExpr(variablesColumn, [
      'empresa',
      'company',
      'nome_empresa',
      'nomeEmpresa',
      'nome_cliente',
      'NOME_CLIENTE',
      'cliente',
      'razao_social',
      'organization_name',
    ]);
    const tipoExpr = jsonValueExpr(variablesColumn, [
      'tipo_beneficiario',
      'tipoBeneficiario',
      'type_kinship',
      'grau_parentesco',
      'grauParentesco',
      'GRAU_PARENTESCO',
      'parentesco',
    ]);
    const whereClause = buildFilters({
      meses,
      groupName,
      company,
      typeFilter,
      hasSessionDate: Boolean(sessionDateColumn),
    });

    const rows = await runQuery(wh.id, `
      WITH base AS (
        SELECT
          ${sessionAtExpr} AS session_at,
          ${grupoExpr} AS grupo_economico,
          ${empresaExpr} AS empresa,
          ${tipoExpr} AS tipo_beneficiario
        FROM hive_metastore.sanus_prod.botmaker_session
      )
      SELECT COUNT(*) AS total_sessoes
      FROM base
      ${whereClause}
    `);

    res.status(200).json({
      total: toInt(rows[0]?.[0]),
      period_filter_applied: meses.length === 0 || Boolean(sessionDateColumn),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
