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
function normalizeCpfExpr(expr) {
  return `NULLIF(regexp_replace(TRIM(CAST(${expr} AS STRING)), '[^0-9]', ''), '')`;
}

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const USERS_TABLE = `hive_metastore.sanus_prod.users`;
const BENEFICIARIES_TABLE = `sanus_databricks.sanus_prod.beneficiaries`;
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

function buildFilters({ meses, hasSessionDate }) {
  const conditions = [];
  if (meses.length > 0 && hasSessionDate) {
    conditions.push(`DATE_FORMAT(session_at, 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`);
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

    const [columns, userColumns, beneficiaryColumns] = await Promise.all([
      getColumns(wh.id, SESSION_TABLE),
      getColumns(wh.id, USERS_TABLE),
      getColumns(wh.id, BENEFICIARIES_TABLE),
    ]);

    const variablesColumn = pickColumn(columns, ['variables']);
    if (!variablesColumn) throw new Error("Coluna variables não encontrada em botmaker_session.");
    const variables = `CAST(${quoteIdent(variablesColumn)} AS STRING)`;

    const sessionDateColumn = pickColumn(columns, [
      'created_at',
      'createdAt',
      'creation_time',
      'creationTime',
      'creation_date',
      'creationDate',
      'created_time',
      'createdTime',
      'session_created_at',
      'session_creation_time',
      'started_at',
      'start_time',
      'startTime',
      'session_start',
      'sessionStart',
      'last_message_at',
      'lastMessageAt',
      'last_interaction_at',
      'lastInteractionAt',
      'updated_at',
      'timestamp',
      'data_criacao',
    ]);
    const sessionAtExpr = sessionDateColumn
      ? `try_cast(${quoteIdent(sessionDateColumn)} AS TIMESTAMP)`
      : `CAST(NULL AS TIMESTAMP)`;

    const inputCpfExpr = normalizeCpfExpr(jsonValueExpr(variablesColumn, [
      'inputcpfholder',
      'inputCpfHolder',
      'input_cpf_holder',
      'cpf_holder',
      'cpfHolder',
      'cpf',
      'CPF',
    ]));

    const userIdColumn = pickColumn(userColumns, ['id', 'user_id', 'userId']);
    const userCpfColumn = pickColumn(userColumns, [
      'cpf',
      'CPF',
      'document',
      'document_number',
      'documentNumber',
      'tax_id',
      'taxId',
      'cpf_holder',
    ]);
    const beneficiaryUserIdColumn = pickColumn(beneficiaryColumns, [
      'user_id',
      'userId',
      'id_user',
      'id_usuario',
      'usuario_id',
    ]);
    const beneficiaryCpfColumn = pickColumn(beneficiaryColumns, [
      'cpf',
      'CPF',
      'document',
      'document_number',
      'documentNumber',
      'tax_id',
      'taxId',
      'cpf_holder',
    ]);
    const beneficiaryOrgColumn = pickColumn(beneficiaryColumns, [
      'organization_id',
      'organizationId',
      'id_empresa',
      'ID_EMPRESA',
      'empresa_id',
      'company_id',
    ]);
    const beneficiaryTypeColumn = pickColumn(beneficiaryColumns, [
      'type_kinship',
      'grau_parentesco',
      'grauParentesco',
      'GRAU_PARENTESCO',
      'kinship',
      'tipo_beneficiario',
      'beneficiary_type',
    ]);

    if (!userIdColumn || !userCpfColumn) throw new Error("Colunas de id/CPF não encontradas em users.");
    if (!beneficiaryOrgColumn) throw new Error("Coluna de empresa não encontrada em beneficiaries.");

    const beneficiaryJoinParts = [];
    if (beneficiaryUserIdColumn) beneficiaryJoinParts.push(`b.user_id = u.user_id`);
    if (beneficiaryCpfColumn) beneficiaryJoinParts.push(`b.cpf = s.cpf_holder`);
    if (beneficiaryJoinParts.length === 0) {
      throw new Error("Não foi possível ligar beneficiaries com users/CPF.");
    }

    const userIdExpr = `CAST(u.${quoteIdent(userIdColumn)} AS STRING)`;
    const userCpfExpr = normalizeCpfExpr(`u.${quoteIdent(userCpfColumn)}`);
    const beneficiaryOrgExpr = `CAST(b.${quoteIdent(beneficiaryOrgColumn)} AS STRING)`;
    const beneficiaryUserIdExpr = beneficiaryUserIdColumn
      ? `CAST(b.${quoteIdent(beneficiaryUserIdColumn)} AS STRING)`
      : `CAST(NULL AS STRING)`;
    const beneficiaryCpfExpr = beneficiaryCpfColumn
      ? normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)
      : `CAST(NULL AS STRING)`;
    const beneficiaryTypeExpr = beneficiaryTypeColumn
      ? `CAST(b.${quoteIdent(beneficiaryTypeColumn)} AS STRING)`
      : `CAST(NULL AS STRING)`;

    const beneficiaryOrgIdent = `b.${quoteIdent(beneficiaryOrgColumn)}`;
    const beneficiaryConditions = [`${beneficiaryOrgExpr} IS NOT NULL`];
    if (groupName) {
      const g = escape(groupName);
      beneficiaryConditions.push(`${beneficiaryOrgIdent} IN (
        SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
        UNION
        SELECT id FROM ${ORGANIZATIONS_TABLE}
        WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
      )`);
    }
    if (company) {
      const c = escape(company);
      beneficiaryConditions.push(`${beneficiaryOrgIdent} IN (
        SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${c}'
      )`);
    }
    if (typeFilter === 'TITULAR' && beneficiaryTypeColumn) {
      beneficiaryConditions.push(`UPPER(TRIM(COALESCE(CAST(b.${quoteIdent(beneficiaryTypeColumn)} AS STRING), ''))) = 'TITULAR'`);
    } else if (typeFilter === 'DEPENDENTE' && beneficiaryTypeColumn) {
      beneficiaryConditions.push(`UPPER(TRIM(COALESCE(CAST(b.${quoteIdent(beneficiaryTypeColumn)} AS STRING), ''))) != 'TITULAR'`);
    }
    const hasBeneficiariesFilter = Boolean(groupName || company || typeFilter);
    const beneficiariesJoinKind = hasBeneficiariesFilter ? 'INNER JOIN' : 'LEFT JOIN';

    const whereClause = buildFilters({
      meses,
      hasSessionDate: Boolean(sessionDateColumn),
    });

    const rows = await runQuery(wh.id, `
      WITH sessions AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY ${sessionAtExpr}, ${inputCpfExpr}, ${variables}) AS session_row_id,
          ${sessionAtExpr} AS session_at,
          ${inputCpfExpr} AS cpf_holder
        FROM ${SESSION_TABLE}
      ),
      users_by_cpf AS (
        SELECT
          ${userIdExpr} AS user_id,
          ${userCpfExpr} AS cpf
        FROM ${USERS_TABLE} u
        WHERE ${userCpfExpr} IS NOT NULL
      ),
      beneficiaries_resolved AS (
        SELECT
          ${beneficiaryOrgExpr} AS organization_id,
          ${beneficiaryTypeExpr} AS tipo_beneficiario,
          ${beneficiaryUserIdExpr} AS user_id,
          ${beneficiaryCpfExpr} AS cpf
        FROM ${BENEFICIARIES_TABLE} b
        WHERE ${beneficiaryConditions.join(' AND ')}
      ),
      base AS (
        SELECT
          s.session_row_id,
          s.session_at,
          b.organization_id,
          b.tipo_beneficiario
        FROM sessions s
        LEFT JOIN users_by_cpf u ON u.cpf = s.cpf_holder
        ${beneficiariesJoinKind} beneficiaries_resolved b ON ${beneficiaryJoinParts.join(' OR ')}
      )
      SELECT COUNT(DISTINCT session_row_id) AS total_sessoes
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
