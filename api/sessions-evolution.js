// api/sessions-evolution.js
// Evolução mensal de sessões finalizadas por Humano e IA (últimos 12 meses).
// - Sem filtro de grupo/empresa: COUNT(*) GROUP BY mês — query rápida.
// - Com filtro: JOIN por botmaker_session.organization_id x organizations.id.
// Aceita ?group_name=, ?company=, ?type=, ?months=12.

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const SESSION_TABLE       = `hive_metastore.sanus_prod.botmaker_session`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;

const SESSION_DATE_COLUMN = 'creation_time';
let cachedWarehouseId = null;

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

async function getWarehouseId() {
  if (cachedWarehouseId) return cachedWarehouseId;
  const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
  const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
  if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");
  cachedWarehouseId = wh.id;
  return cachedWarehouseId;
}

const escape = (s) => String(s).replace(/'/g, "''");
const quoteIdent = (s) => `\`${String(s).replace(/`/g, "``")}\``;

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

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

function nextMonth(month) {
  const [year, mm] = month.split('-').map((value) => parseInt(value, 10));
  const d = new Date(Date.UTC(year, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const granularity = req.query.granularity || 'month';
  const dayMonth = req.query.mes && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : null;
  const months = Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24);
  const hasOrgFilter = Boolean(groupName || company);

  const monthList = lastNMonthsList(months);
  const sessionDateColumn = `s.${quoteIdent(SESSION_DATE_COLUMN)}`;
  const sessionDateExpr = `try_cast(${sessionDateColumn} AS TIMESTAMP)`;
  const monthsSqlFilter = `(${monthList.map((month) => `(${sessionDateColumn} >= '${month}-01' AND ${sessionDateColumn} < '${nextMonth(month)}-01')`).join(' OR ')})`;
  const selectedDayMonth = dayMonth || monthList[monthList.length - 1];
  const daySqlFilter = `${sessionDateColumn} >= '${selectedDayMonth}-01'
    AND ${sessionDateColumn} < '${nextMonth(selectedDayMonth)}-01'`;

  try {
    const warehouseId = await getWarehouseId();

    const filters = [granularity === 'day' ? daySqlFilter : monthsSqlFilter];
    if (hasOrgFilter) {
      filters.push(`CAST(o.${quoteIdent('id')} AS STRING) IN ${orgIdsSubquery(groupName, company)}`);
    }
    const fromSql = hasOrgFilter
      ? `${SESSION_TABLE} s
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(s.${quoteIdent('organization_id')} AS STRING) = CAST(o.${quoteIdent('id')} AS STRING)`
      : `${SESSION_TABLE} s`;
    const where = `WHERE ${filters.join(' AND ')}`;
    const mode = hasOrgFilter ? "organization_join" : "global";
    if (granularity === 'day') {
      const rows = await runQuery(warehouseId, `
        SELECT
          DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM-dd') AS dia,
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
          COUNT(*) AS total
        FROM ${fromSql}
        ${where}
        GROUP BY
          DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM-dd'),
          CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
        ORDER BY dia
      `);

      const byDiaTipo = new Map(rows.map((r) => [
        `${String(getCell(r[0]) || '')}|${String(getCell(r[1]) || '').toUpperCase()}`,
        toInt(r[2]),
      ]));
      const days = [];
      const start = new Date(`${selectedDayMonth}-01T00:00:00Z`);
      const end = new Date(`${nextMonth(selectedDayMonth)}-01T00:00:00Z`);
      for (const d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
        days.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
      }
      const series = days.map((day) => {
        const humano = byDiaTipo.get(`${day}|HUMANO`) || 0;
        const ia = byDiaTipo.get(`${day}|IA`) || 0;
        return { dia: day, humano, ia, total: humano + ia };
      });

      return res.status(200).json({
        granularity: "day",
        month: selectedDayMonth,
        series,
        filters: { group_name: groupName, company, type: typeFilter },
        mode,
        source: "botmaker_session.creation_time",
      });
    }

    const rows = await runQuery(warehouseId, `
      SELECT
        DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM') AS mes,
        CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END AS tipo_atendimento,
        COUNT(*) AS total
      FROM ${fromSql}
      ${where}
      GROUP BY
        DATE_FORMAT(${sessionDateExpr}, 'yyyy-MM'),
        CASE WHEN s.finished_by IS NOT NULL THEN 'Humano' ELSE 'IA' END
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
