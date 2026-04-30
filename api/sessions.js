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
  const useCompanyFilterSum = Boolean(groupName || company);
  const extraFilter = buildExtraFilter(groupName, company, typeFilter);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const needsSessionColumns = meses.length > 0 || Boolean(groupName || company);
    const sessionColumns = needsSessionColumns ? await getColumns(wh.id, SESSION_TABLE) : [];
    const sessionDateColumn = pickColumn(sessionColumns, [
      'created_at',
      'createdAt',
      'creation_time',
      'creationTime',
      'created_time',
      'createdTime',
      'session_created_at',
      'session_creation_time',
      'started_at',
      'start_time',
      'startTime',
      'last_message_at',
      'lastMessageAt',
      'last_interaction_at',
      'lastInteractionAt',
      'updated_at',
      'timestamp',
      'data_criacao',
    ]);
    const variablesColumn = pickColumn(sessionColumns, ['variables']);
    const sessionOrgColumn = pickColumn(sessionColumns, [
      'organization_id',
      'organizationId',
      'org_id',
      'orgId',
      'id_empresa',
      'ID_EMPRESA',
      'empresa_id',
      'company_id',
      'companyId',
    ]);
    const sessionCompanyColumn = pickColumn(sessionColumns, [
      'company',
      'company_name',
      'companyName',
      'nome_cliente',
      'NOME_CLIENTE',
      'organization',
      'organization_name',
      'organizationName',
    ]);
    const sessionGroupColumn = pickColumn(sessionColumns, [
      'grupo_economico',
      'economic_group',
      'economicGroup',
      'group_name',
      'groupName',
    ]);
    const sessionDateFilter = meses.length > 0 && sessionDateColumn
      ? `DATE_FORMAT(try_cast(${quoteIdent(sessionDateColumn)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`
      : null;
    const sessionOrgConditions = [];
    if (groupName || company) {
      const idsSubquery = orgIdsSubquery(groupName, company);
      const namesSubquery = orgNamesSubquery(groupName, company);
      if (sessionOrgColumn) {
        sessionOrgConditions.push(`CAST(${quoteIdent(sessionOrgColumn)} AS STRING) IN ${idsSubquery}`);
      }
      if (sessionCompanyColumn) {
        sessionOrgConditions.push(textInExpr(quoteIdent(sessionCompanyColumn), namesSubquery));
      }
      if (groupName && sessionGroupColumn) {
        sessionOrgConditions.push(textEqualsExpr(quoteIdent(sessionGroupColumn), groupName));
      }
      if (variablesColumn) {
        const variableOrgId = jsonValueExpr(variablesColumn, [
          'organization_id',
          'organizationId',
          'org_id',
          'orgId',
          'id_empresa',
          'ID_EMPRESA',
          'empresa_id',
          'company_id',
          'companyId',
        ]);
        const variableCompany = jsonValueExpr(variablesColumn, [
          'company',
          'company_name',
          'companyName',
          'nome_cliente',
          'NOME_CLIENTE',
          'organization',
          'organization_name',
          'organizationName',
        ]);
        const variableGroup = jsonValueExpr(variablesColumn, [
          'grupo_economico',
          'economic_group',
          'economicGroup',
          'group_name',
          'groupName',
        ]);
        sessionOrgConditions.push(`CAST(${variableOrgId} AS STRING) IN ${idsSubquery}`);
        sessionOrgConditions.push(textInExpr(variableCompany, namesSubquery));
        if (groupName) sessionOrgConditions.push(textEqualsExpr(variableGroup, groupName));
      }
    }
    const sessionOrgFilter = sessionOrgConditions.length ? `(${sessionOrgConditions.join(' OR ')})` : null;
    const sessionFilters = [sessionDateFilter, sessionOrgFilter].filter(Boolean);
    const sessionWhere = sessionFilters.length ? `WHERE ${sessionFilters.join(' AND ')}` : '';
    const finishersFilterApplied = {
      period: meses.length === 0 || Boolean(sessionDateColumn),
      organization: !groupName && !company ? true : Boolean(sessionOrgFilter),
      type: !typeFilter,
    };

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

    const finishersPromise = runQuery(wh.id, `
      SELECT
        CASE
          WHEN finished_by IS NOT NULL THEN 'Humano'
          ELSE 'IA'
        END AS tipo_atendimento,
        COUNT(*) AS total_sessions
      FROM ${SESSION_TABLE}
      ${sessionWhere}
      GROUP BY
        CASE
          WHEN finished_by IS NOT NULL THEN 'Humano'
          ELSE 'IA'
        END
    `);

    const [rows, finisherRows] = await Promise.all([totalPromise, finishersPromise]);
    const finishers = finisherRows.map((r) => ({
      tipo: String(getCell(r[0]) || "—"),
      total: toInt(r[1]),
    }));

    const row = rows[0] || [];
    res.status(200).json({
      total: toInt(row[0]),
      empresas: toInt(row[1]),
      finishers,
      finishers_filter_applied: finishersFilterApplied,
      source: useCompanyFilterSum ? "company_filter_sum" : "botmaker_session",
      period_filter_applied: useCompanyFilterSum ? false : meses.length === 0 || Boolean(sessionDateColumn),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
