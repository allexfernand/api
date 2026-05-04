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
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;

function sessionTypificationExpr(variablesColumn, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const raw = `${prefix}${quoteIdent(variablesColumn)}['typification']`;
  return `CASE
    WHEN ${raw} IS NULL THEN '(NULO)'
    WHEN TRIM(CAST(${raw} AS STRING)) = '' THEN '(VAZIO/BRANCO)'
    ELSE TRIM(CAST(${raw} AS STRING))
  END`;
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const meses = req.query.meses ? req.query.meses.split(',').filter((m) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typificationFinisher = ['humano', 'ia'].includes(String(req.query.typification_finisher || '').toLowerCase())
    ? String(req.query.typification_finisher).toLowerCase()
    : '';

  const SESSION_DATE_COLUMN = 'creation_time';

  const buildSessionDateFilter = (mesesArr) => mesesArr.length > 0
    ? `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${mesesArr.map((m) => `'${m}'`).join(',')})`
    : null;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const sessionDateFilter = buildSessionDateFilter(meses);
    const aliasedTypificationExpr = sessionTypificationExpr('variables', 's');
    const companySessionsDateFilter = meses.length > 0
      ? `DATE_FORMAT(try_cast(s.${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((m) => `'${m}'`).join(',')})`
      : null;
    const companySessionsOrgFilter = company
      ? `CAST(o.${quoteIdent('id')} AS STRING) IN ${orgIdsSubquery(null, company)}`
      : (groupName ? `CAST(o.${quoteIdent('id')} AS STRING) IN ${orgIdsSubquery(groupName, null)}` : null);
    const companySessionsWhere = [companySessionsDateFilter, companySessionsOrgFilter].filter(Boolean).join(' AND ');
    const companySessionsMode = groupName || company ? "company" : "economic_group";
    const companySessionsSource = companySessionsMode === "company"
      ? "botmaker_session.organization_id + organizations.id/name"
      : "botmaker_session.economic_group_name";
    const typificationFinisherFilter = typificationFinisher === 'humano'
      ? 's.finished_by IS NOT NULL'
      : (typificationFinisher === 'ia' ? 's.finished_by IS NULL' : null);

    const economicGroupTotalPromise = companySessionsMode === "company"
      ? runQuery(wh.id, `
        SELECT COUNT(*) AS total
        FROM ${SESSION_TABLE} s
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)
        WHERE o.${quoteIdent('name')} IS NOT NULL
          AND TRIM(CAST(o.${quoteIdent('name')} AS STRING)) != ''
          ${companySessionsWhere ? `AND ${companySessionsWhere}` : ''}
      `)
      : runQuery(wh.id, `
        SELECT COUNT(*) AS total
        FROM ${SESSION_TABLE} s
        ${companySessionsDateFilter ? `WHERE ${companySessionsDateFilter}` : ''}
      `);

    const economicGroupFinishersPromise = companySessionsMode === "company"
      ? runQuery(wh.id, `
        SELECT
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE} s
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)
        WHERE o.${quoteIdent('name')} IS NOT NULL
          AND TRIM(CAST(o.${quoteIdent('name')} AS STRING)) != ''
          ${companySessionsWhere ? `AND ${companySessionsWhere}` : ''}
        GROUP BY CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
        ORDER BY total_sessions DESC
      `)
      : runQuery(wh.id, `
        SELECT
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE} s
        ${companySessionsDateFilter ? `WHERE ${companySessionsDateFilter}` : ''}
        GROUP BY CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
        ORDER BY total_sessions DESC
      `);

    const companySessionsPromise = companySessionsMode === "company"
      ? runQuery(wh.id, `
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
      `)
      : runQuery(wh.id, `
        SELECT
          CASE
            WHEN s.${quoteIdent('economic_group_name')} IS NULL
              OR TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING)) = ''
            THEN 'Nulos'
            ELSE TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING))
          END AS empresa,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE} s
        ${companySessionsDateFilter ? `WHERE ${companySessionsDateFilter}` : ''}
        GROUP BY CASE
          WHEN s.${quoteIdent('economic_group_name')} IS NULL
            OR TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING)) = ''
          THEN 'Nulos'
          ELSE TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING))
        END
        ORDER BY total_sessions DESC
      `);

    const typificationsPromise = companySessionsMode === "company"
      ? runQuery(wh.id, `
        SELECT
          ${aliasedTypificationExpr} AS tipificacao,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE} s
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)
        WHERE o.${quoteIdent('name')} IS NOT NULL
          AND TRIM(CAST(o.${quoteIdent('name')} AS STRING)) != ''
          ${companySessionsWhere ? `AND ${companySessionsWhere}` : ''}
          ${typificationFinisherFilter ? `AND ${typificationFinisherFilter}` : ''}
        GROUP BY ${aliasedTypificationExpr}
        ORDER BY total_sessions DESC
        LIMIT 30
      `)
      : runQuery(wh.id, `
        SELECT
          ${aliasedTypificationExpr} AS tipificacao,
          COUNT(*) AS total_sessions
        FROM ${SESSION_TABLE} s
        ${[companySessionsDateFilter, typificationFinisherFilter].filter(Boolean).length ? `WHERE ${[companySessionsDateFilter, typificationFinisherFilter].filter(Boolean).join(' AND ')}` : ''}
        GROUP BY ${aliasedTypificationExpr}
        ORDER BY total_sessions DESC
        LIMIT 30
      `);

    const [typificationsSettled, economicGroupFinishersSettled, economicGroupTotalSettled, companySessionsSettled] = await Promise.allSettled([
      typificationsPromise,
      economicGroupFinishersPromise,
      economicGroupTotalPromise,
      companySessionsPromise,
    ]);

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
    const companySessionsError = companySessionsSettled.status === 'rejected'
      ? (companySessionsSettled.reason instanceof Error ? companySessionsSettled.reason.message : String(companySessionsSettled.reason))
      : null;
    const companySessions = companySessionsSettled.status === 'fulfilled'
      ? companySessionsSettled.value.map((r) => ({
          empresa: String(getCell(r[0]) || "Sem empresa"),
          total: toInt(r[1]),
        }))
      : [];
    const economicGroupTotalQueryError = economicGroupTotalSettled.status === 'rejected'
      ? (economicGroupTotalSettled.reason instanceof Error ? economicGroupTotalSettled.reason.message : String(economicGroupTotalSettled.reason))
      : null;
    const economicGroupTotalFallback = economicGroupTotalSettled.status === 'fulfilled'
      ? toInt(economicGroupTotalSettled.value[0]?.[0])
      : 0;
    const companySessionsTotal = companySessions.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const economicGroupTotal = companySessionsSettled.status === 'fulfilled' ? companySessionsTotal : economicGroupTotalFallback;
    const economicGroupTotalError = companySessionsError || (companySessionsSettled.status === 'fulfilled' ? null : economicGroupTotalQueryError);

    res.status(200).json({
      economic_group_total: economicGroupTotal,
      economic_group_total_error: economicGroupTotalError,
      company_sessions: companySessions,
      company_sessions_error: companySessionsError,
      company_sessions_mode: companySessionsMode,
      company_sessions_source: companySessionsSource,
      economic_group_finishers: economicGroupFinishers,
      economic_group_finishers_error: economicGroupFinishersError,
      economic_group_finishers_filter_applied: { period: true, organization: true },
      typifications,
      typifications_error: typificationsError,
      typifications_finisher: typificationFinisher,
      typifications_filter_applied: { period: true, organization: true, finisher: Boolean(typificationFinisher) },
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
