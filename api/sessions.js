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

function sessionTypificationExpr(variablesColumn) {
  const raw = `${quoteIdent(variablesColumn)}['typification']`;
  return `CASE
    WHEN ${raw} IS NULL THEN '(NULO)'
    WHEN TRIM(CAST(${raw} AS STRING)) = '' THEN '(VAZIO/BRANCO)'
    ELSE TRIM(CAST(${raw} AS STRING))
  END`;
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
  const localFinisherGroupName = req.query.finishers_group_name || null;
  const finisherGroupName = localFinisherGroupName || groupName;
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
    const typificationExpr = sessionTypificationExpr('variables');
    const economicGroupFilter = finisherGroupName
      ? `UPPER(TRIM(CAST(${quoteIdent('economic_group_name')} AS STRING))) = UPPER(TRIM('${escape(finisherGroupName)}'))`
      : null;
    const economicGroupWhere = [sessionDateFilter, economicGroupFilter].filter(Boolean).join(' AND ');
    const companySessionsDateFilter = meses.length > 0
      ? `DATE_FORMAT(try_cast(s.${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`
      : null;
    const companySessionsOrgFilter = company
      ? `CAST(o.${quoteIdent('id')} AS STRING) IN ${orgIdsSubquery(null, company)}`
      : (groupName ? `CAST(o.${quoteIdent('id')} AS STRING) IN ${orgIdsSubquery(groupName, null)}` : null);
    const companySessionsWhere = [companySessionsDateFilter, companySessionsOrgFilter].filter(Boolean).join(' AND ');
    const beneficiaryColumns = useCompanyFilterSum ? await getColumns(wh.id, VW_BENEFICIARIOS) : [];
    const beneficiaryCpfColumn = pickColumn(beneficiaryColumns, [
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

    const economicGroupTotalPromise = runQuery(wh.id, `
      SELECT COUNT(*) AS total
      FROM ${SESSION_TABLE}
      ${economicGroupWhere ? `WHERE ${economicGroupWhere}` : ''}
    `);

    const economicGroupFinishersPromise = runQuery(wh.id, `
      SELECT
        CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
        COUNT(*) AS total_sessions
      FROM ${SESSION_TABLE}
      ${economicGroupWhere ? `WHERE ${economicGroupWhere}` : ''}
      GROUP BY CASE WHEN finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
      ORDER BY total_sessions DESC
    `);

    const companySessionsPromise = runQuery(wh.id, `
      SELECT
        TRIM(CAST(o.${quoteIdent('name')} AS STRING)) AS empresa,
        COUNT(*) AS total_sessions
      FROM ${SESSION_TABLE} s
      INNER JOIN ${ORGANIZATIONS_TABLE} o
        ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)
      WHERE o.${quoteIdent('name')} IS NOT NULL
        AND TRIM(CAST(o.${quoteIdent('name')} AS STRING)) != ''
        ${companySessionsWhere ? `AND ${companySessionsWhere}` : ''}
      GROUP BY TRIM(CAST(o.${quoteIdent('name')} AS STRING))
      ORDER BY total_sessions DESC
      LIMIT 100
    `);

    const economicGroupOptionsPromise = runQueryQuick(wh.id, `
      SELECT
        TRIM(CAST(${quoteIdent('economic_group_name')} AS STRING)) AS economic_group_name,
        COUNT(*) AS total_sessions
      FROM ${SESSION_TABLE}
      WHERE ${sessionDateFilter ? `${sessionDateFilter} AND ` : ''}${quoteIdent('economic_group_name')} IS NOT NULL
        AND TRIM(CAST(${quoteIdent('economic_group_name')} AS STRING)) != ''
      GROUP BY TRIM(CAST(${quoteIdent('economic_group_name')} AS STRING))
      ORDER BY total_sessions DESC
      LIMIT 200
    `);

    const typificationsPromise = useCompanyFilterSum
      ? (beneficiaryCpfColumn ? runQueryQuick(wh.id, `
        WITH filtered_cpfs AS (
          SELECT DISTINCT ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} AS cpf
          FROM ${VW_BENEFICIARIOS} b
          WHERE NOME_CLIENTE IS NOT NULL
            ${extraFilter}
            AND ${normalizeCpfExpr(`b.${quoteIdent(beneficiaryCpfColumn)}`)} IS NOT NULL
        ),
        sessions_filtered AS (
          SELECT ${typificationExpr} AS tipificacao, ${quoteIdent('variables')} AS variables
          FROM ${SESSION_TABLE}
          WHERE ${sessionDateFilter ? `${sessionDateFilter} AND ` : ''}${sessionVariablesPrefilter('variables')}
        ),
        sessions_resolved AS (
          SELECT tipificacao, ${sessionCpfExpr('variables')} AS cpf
          FROM sessions_filtered
        )
        SELECT /*+ BROADCAST(filtered_cpfs) */
          s.tipificacao,
          COUNT(*) AS total_sessions
        FROM sessions_resolved s
        INNER JOIN filtered_cpfs fc ON fc.cpf = s.cpf
        WHERE s.cpf IS NOT NULL
        GROUP BY s.tipificacao
        ORDER BY total_sessions DESC
        LIMIT 30
      `) : Promise.reject(new Error(`Coluna de CPF/documento não encontrada em ${VW_BENEFICIARIOS}. Colunas disponíveis: ${beneficiaryColumns.slice(0, 80).join(', ')}`)))
      : runQuery(wh.id, `
        SELECT
          ${typificationExpr} AS tipificacao,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE}
        ${sessionDateFilter ? `WHERE ${sessionDateFilter}` : ''}
        GROUP BY ${typificationExpr}
        ORDER BY total_sessions DESC
        LIMIT 30
      `);

    const [totalSettled, typificationsSettled, economicGroupFinishersSettled, economicGroupOptionsSettled, economicGroupTotalSettled, companySessionsSettled] = await Promise.allSettled([
      totalPromise,
      typificationsPromise,
      economicGroupFinishersPromise,
      economicGroupOptionsPromise,
      economicGroupTotalPromise,
      companySessionsPromise,
    ]);
    if (totalSettled.status !== 'fulfilled') {
      throw totalSettled.reason instanceof Error ? totalSettled.reason : new Error(String(totalSettled.reason));
    }
    const rows = totalSettled.value;
    const row = rows[0] || [];
    const total = toInt(row[0]);

    const typificationsError = typificationsSettled.status === 'rejected'
      ? (typificationsSettled.reason instanceof Error ? typificationsSettled.reason.message : String(typificationsSettled.reason))
      : null;
    const typifications = typificationsSettled.status === 'fulfilled'
      ? typificationsSettled.value.map((r) => ({
          tipo: String(getCell(r[0]) || "—"),
          total: toInt(r[1]),
        }))
      : [];
    const economicGroupFinishersError = economicGroupFinishersSettled.status === 'rejected'
      ? (economicGroupFinishersSettled.reason instanceof Error ? economicGroupFinishersSettled.reason.message : String(economicGroupFinishersSettled.reason))
      : null;
    const economicGroupFinishers = economicGroupFinishersSettled.status === 'fulfilled'
      ? economicGroupFinishersSettled.value.map((r) => ({
          tipo: String(getCell(r[0]) || "—"),
          total: toInt(r[1]),
        }))
      : [];
    const economicGroupOptions = economicGroupOptionsSettled.status === 'fulfilled'
      ? economicGroupOptionsSettled.value.map((r) => ({
          name: String(getCell(r[0]) || ""),
          total: toInt(r[1]),
        })).filter((item) => item.name)
      : [];
    const economicGroupTotalError = economicGroupTotalSettled.status === 'rejected'
      ? (economicGroupTotalSettled.reason instanceof Error ? economicGroupTotalSettled.reason.message : String(economicGroupTotalSettled.reason))
      : null;
    const economicGroupTotal = economicGroupTotalSettled.status === 'fulfilled'
      ? toInt(economicGroupTotalSettled.value[0]?.[0])
      : 0;
    const companySessionsError = companySessionsSettled.status === 'rejected'
      ? (companySessionsSettled.reason instanceof Error ? companySessionsSettled.reason.message : String(companySessionsSettled.reason))
      : null;
    const companySessions = companySessionsSettled.status === 'fulfilled'
      ? companySessionsSettled.value.map((r) => ({
          empresa: String(getCell(r[0]) || "Sem empresa"),
          total: toInt(r[1]),
        }))
      : [];

    res.status(200).json({
      total,
      empresas: toInt(row[1]),
      finishers_group_name: finisherGroupName,
      economic_group_total: economicGroupTotal,
      economic_group_total_error: economicGroupTotalError,
      company_sessions: companySessions,
      company_sessions_error: companySessionsError,
      company_sessions_source: "botmaker_session.organization_id + organizations.id/name",
      economic_group_options: economicGroupOptions,
      economic_group_finishers: economicGroupFinishers,
      economic_group_finishers_error: economicGroupFinishersError,
      economic_group_finishers_filter_applied: { period: true, group: true, company: !company },
      typifications,
      typifications_error: typificationsError,
      typifications_filter_applied: { period: true, organization: true, type: true },
      source: useCompanyFilterSum ? "company_filter_sum" : "botmaker_session",
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
