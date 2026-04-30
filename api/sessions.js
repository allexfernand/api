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

    if (!beneficiaryUserIdColumn && !beneficiaryCpfColumn) {
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
    const orgFilterSubqueries = [];
    if (groupName) {
      const g = escape(groupName);
      const sub = `(
        SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}'
        UNION
        SELECT id FROM ${ORGANIZATIONS_TABLE}
        WHERE matriz_id = (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${g}' LIMIT 1)
      )`;
      beneficiaryConditions.push(`${beneficiaryOrgIdent} IN ${sub}`);
      orgFilterSubqueries.push(sub);
    }
    if (company) {
      const c = escape(company);
      const sub = `(SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE name = '${c}')`;
      beneficiaryConditions.push(`${beneficiaryOrgIdent} IN ${sub}`);
      orgFilterSubqueries.push(sub);
    }
    if (typeFilter === 'TITULAR' && beneficiaryTypeColumn) {
      beneficiaryConditions.push(`UPPER(TRIM(COALESCE(CAST(b.${quoteIdent(beneficiaryTypeColumn)} AS STRING), ''))) = 'TITULAR'`);
    } else if (typeFilter === 'DEPENDENTE' && beneficiaryTypeColumn) {
      beneficiaryConditions.push(`UPPER(TRIM(COALESCE(CAST(b.${quoteIdent(beneficiaryTypeColumn)} AS STRING), ''))) != 'TITULAR'`);
    }
    const hasBeneficiariesFilter = Boolean(groupName || company || typeFilter);

    const sessionWhereParts = [`${inputCpfExpr} IS NOT NULL`];
    if (meses.length > 0 && sessionDateColumn) {
      sessionWhereParts.push(`DATE_FORMAT(${sessionAtExpr}, 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`);
    }

    const mainQueryPromise = hasBeneficiariesFilter
      ? runQuery(wh.id, `
        WITH beneficiaries_resolved AS (
          SELECT
            ${beneficiaryUserIdExpr} AS user_id,
            ${beneficiaryCpfExpr} AS cpf
          FROM ${BENEFICIARIES_TABLE} b
          WHERE ${beneficiaryConditions.join(' AND ')}
        ),
        relevant_cpfs AS (
          SELECT cpf FROM beneficiaries_resolved WHERE cpf IS NOT NULL
          UNION
          SELECT ${userCpfExpr} AS cpf
          FROM ${USERS_TABLE} u
          WHERE ${userCpfExpr} IS NOT NULL
            AND ${userIdExpr} IN (SELECT user_id FROM beneficiaries_resolved WHERE user_id IS NOT NULL)
        )
        SELECT COUNT(*) AS total_sessoes
        FROM (
          SELECT ${inputCpfExpr} AS cpf_holder
          FROM ${SESSION_TABLE}
          WHERE ${sessionWhereParts.join(' AND ')}
        ) s
        WHERE s.cpf_holder IN (SELECT cpf FROM relevant_cpfs)
      `)
      : runQuery(wh.id, `
        SELECT COUNT(*) AS total_sessoes
        FROM ${SESSION_TABLE}
        ${meses.length > 0 && sessionDateColumn ? `WHERE DATE_FORMAT(${sessionAtExpr}, 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})` : ''}
      `);

    const wantDebug = req.query.debug === '1' || hasBeneficiariesFilter;
    const debugQueryPromise = wantDebug && orgFilterSubqueries.length > 0
      ? runQuery(wh.id, `
        SELECT
          (SELECT COUNT(*) FROM ${ORGANIZATIONS_TABLE} WHERE id IN ${orgFilterSubqueries[0]}) AS orgs_in_filter,
          (SELECT COUNT(*) FROM ${BENEFICIARIES_TABLE} b WHERE ${beneficiaryConditions.join(' AND ')}) AS beneficiaries_in_filter,
          (SELECT COUNT(*) FROM ${BENEFICIARIES_TABLE} b
            WHERE ${beneficiaryConditions.join(' AND ')}
              AND ${beneficiaryCpfExpr} IS NOT NULL
          ) AS beneficiaries_in_filter_with_cpf,
          (SELECT SUBSTRING(${variables}, 1, 600) FROM ${SESSION_TABLE} WHERE ${variables} IS NOT NULL LIMIT 1) AS sample_variables
      `)
      : Promise.resolve(null);

    const [rows, debugRows] = await Promise.all([mainQueryPromise, debugQueryPromise]);

    const getStr = (cell) => {
      const v = getCell(cell);
      return v === null || v === undefined ? null : String(v);
    };
    const debug = debugRows && debugRows[0]
      ? {
          orgs_in_filter: toInt(debugRows[0][0]),
          beneficiaries_in_filter: toInt(debugRows[0][1]),
          beneficiaries_in_filter_with_cpf: toInt(debugRows[0][2]),
          sample_variables: getStr(debugRows[0][3]),
          session_columns: columns,
        }
      : null;

    res.status(200).json({
      total: toInt(rows[0]?.[0]),
      period_filter_applied: meses.length === 0 || Boolean(sessionDateColumn),
      debug,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
