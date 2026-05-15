// api/sessions.ts
declare const process: { env: Record<string, string | undefined> };

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

type DbOptions = RequestInit & { headers?: Record<string, string> };
type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
type DatabricksRow = DatabricksCell[];
type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
type Warehouse = { id: string; state?: string };

async function dbFetch(path: string, options: DbOptions = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId: string, sql: string): Promise<DatabricksRow[]> {
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

function escape(s: unknown) { return String(s).replace(/'/g, "''"); }
function quoteIdent(s: unknown) { return `\`${String(s).replace(/`/g, "``")}\``; }

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };

const SESSION_TABLE = `hive_metastore.sanus_prod.botmaker_session`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;

function sessionTypificationExpr(variablesColumn: string, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  const raw = `${prefix}${quoteIdent(variablesColumn)}['typification']`;
  return `CASE
    WHEN ${raw} IS NULL THEN '(NULO)'
    WHEN TRIM(CAST(${raw} AS STRING)) = '' THEN '(VAZIO/BRANCO)'
    ELSE TRIM(CAST(${raw} AS STRING))
  END`;
}

function orgIdsSubquery(groupName: unknown, company: unknown) {
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

function lastNMonthsList(n: number) {
  const out = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const dd = new Date(d);
    dd.setUTCMonth(d.getUTCMonth() - i);
    out.push(`${dd.getUTCFullYear()}-${String(dd.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const meses = req.query.meses ? req.query.meses.split(',').filter((m: string) => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typificationFinisher = ['humano', 'ia'].includes(String(req.query.typification_finisher || '').toLowerCase())
    ? String(req.query.typification_finisher).toLowerCase()
    : '';

  const SESSION_DATE_COLUMN = 'creation_time';

  const buildSessionDateFilter = (mesesArr: string[]) => mesesArr.length > 0
    ? `DATE_FORMAT(try_cast(${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${mesesArr.map((m) => `'${m}'`).join(',')})`
    : null;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const sessionDateFilter = buildSessionDateFilter(meses);
    const aliasedTypificationExpr = sessionTypificationExpr('variables', 's');
    const companySessionsDateFilter = meses.length > 0
      ? `DATE_FORMAT(try_cast(s.${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${meses.map((m: string) => `'${m}'`).join(',')})`
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
    const topGroupMonths = meses.length ? [...meses].sort() : lastNMonthsList(12);
    const topGroupDateFilter = `DATE_FORMAT(try_cast(s.${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') IN (${topGroupMonths.map((m) => `'${m}'`).join(',')})`;
    const topGroupByCompany = Boolean(groupName || company);
    const topGroupNameExpr = topGroupByCompany
      ? `TRIM(CAST(o.${quoteIdent('name')} AS STRING))`
      : `TRIM(CAST(s.${quoteIdent('economic_group_name')} AS STRING))`;
    const topGroupValidFilter = topGroupByCompany
      ? `o.${quoteIdent('name')} IS NOT NULL AND ${topGroupNameExpr} != ''`
      : `s.${quoteIdent('economic_group_name')} IS NOT NULL AND ${topGroupNameExpr} != ''`;
    const topGroupWhere = [topGroupDateFilter, companySessionsOrgFilter, topGroupValidFilter].filter(Boolean).join(' AND ');
    const topGroupFromSql = topGroupByCompany || companySessionsOrgFilter
      ? `${SESSION_TABLE} s
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)`
      : `${SESSION_TABLE} s`;

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

    const topGroupsEvolutionPromise = runQuery(wh.id, `
      WITH scoped_sessions AS (
        SELECT
          DATE_FORMAT(try_cast(s.${quoteIdent(SESSION_DATE_COLUMN)} AS TIMESTAMP), 'yyyy-MM') AS mes,
          ${topGroupNameExpr} AS grupo
        FROM ${topGroupFromSql}
        WHERE ${topGroupWhere}
      ),
      latest_month AS (
        SELECT MAX(mes) AS mes
        FROM scoped_sessions
      ),
      top_groups AS (
        SELECT
          ss.grupo,
          COUNT(*) AS current_sessions
        FROM scoped_sessions ss
        INNER JOIN latest_month lm ON lm.mes = ss.mes
        GROUP BY ss.grupo
        ORDER BY current_sessions DESC
        LIMIT 5
      )
      SELECT
        s.mes,
        s.grupo,
        COUNT(*) AS total_sessions,
        tg.current_sessions
      FROM scoped_sessions s
      INNER JOIN top_groups tg ON tg.grupo = s.grupo
      GROUP BY s.mes, s.grupo, tg.current_sessions
      ORDER BY tg.current_sessions DESC, s.grupo, s.mes
    `);

    const [typificationsSettled, economicGroupFinishersSettled, companySessionsSettled, topGroupsEvolutionSettled] = await Promise.allSettled([
      typificationsPromise,
      economicGroupFinishersPromise,
      companySessionsPromise,
      topGroupsEvolutionPromise,
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
    const companySessionsTotal = companySessions.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
    const economicGroupTotal = companySessionsSettled.status === 'fulfilled' ? companySessionsTotal : 0;
    const economicGroupTotalError = companySessionsError;
    const topGroupsEvolutionError = topGroupsEvolutionSettled.status === 'rejected'
      ? (topGroupsEvolutionSettled.reason instanceof Error ? topGroupsEvolutionSettled.reason.message : String(topGroupsEvolutionSettled.reason))
      : null;
    const topGroupsEvolutionRows = topGroupsEvolutionSettled.status === 'fulfilled'
      ? topGroupsEvolutionSettled.value.map((r) => ({
          mes: String(getCell(r[0]) || ''),
          grupo: String(getCell(r[1]) || ''),
          total: toInt(r[2]),
          current_total: toInt(r[3]),
        }))
      : [];
    const topGroups = [...new Set(topGroupsEvolutionRows.map((row) => row.grupo))];

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
      top_groups_evolution: {
        months: topGroupMonths,
        groups: topGroups,
        series: topGroupsEvolutionRows,
        error: topGroupsEvolutionError,
        source: topGroupByCompany ? "botmaker_session.organization_id + organizations.name" : "botmaker_session.economic_group_name",
        dimension: topGroupByCompany ? "company" : "economic_group",
        ranking: topGroupByCompany ? "top_5_companies_latest_month_non_null" : "top_5_latest_month_non_null",
      },
      period_filter_applied: meses.length > 0,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
