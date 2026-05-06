// api/appointments.js
const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const APPOINTMENTS_TABLE = `hive_metastore.sanus_prod.atendimento_summarized_gold_live`;
const APPOINTMENTS_DATE_COLUMN = 'hora_criacao_atendimento';
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

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };
const escape = (s) => String(s).replace(/'/g, "''");
const quoteIdent = (s) => `\`${String(s).replace(/`/g, "``")}\``;

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

  const meses     = req.query.meses ? req.query.meses.split(',').filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;
  const monthList = meses.length ? meses.sort() : lastNMonthsList(Math.min(Math.max(parseInt(req.query.months) || 12, 1), 24));
  const monthRangeFilter = monthList.map((month) => `(
    ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} >= '${month}-01'
    AND ${quoteIdent(APPOINTMENTS_DATE_COLUMN)} < '${nextMonth(month)}-01'
  )`).join(' OR ');

  const groupFilter = groupName
    ? `AND grupo_economico LIKE '%${escape(groupName)}'`
    : '';

  try {
    const warehouseId = await getWarehouseId();

    const rows = await runQuery(warehouseId, `
      SELECT COUNT(*) AS total_tickets
      FROM ${APPOINTMENTS_TABLE}
      WHERE (${monthRangeFilter})
        AND UPPER(assunto) NOT IN (
          'ATENDIMENTO WHATSAPP',
          'ATENDIMENTO HUMANO',
          'FORA DE HORÁRIO DE ATENDIMENTO'
        )
        AND LOWER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%http%'
        AND UPPER(COALESCE(CAST(assunto AS STRING), '')) NOT LIKE '%ATENDIMENTO HUMANO%'
        AND UPPER(TRIM(REGEXP_REPLACE(COALESCE(CAST(assunto AS STRING), ''), '[^A-Za-z0-9]+', ' '))) NOT LIKE '%ATENDIMENTO%HUMANO%'
        AND NOT (
          assunto RLIKE '^[A-Z][a-z]+ [A-Z]'
          OR assunto RLIKE '^[A-Z][A-Z]+ [A-Z]'
          OR assunto RLIKE '^ [A-Z]'
        )
        ${groupFilter}
    `);

    res.status(200).json({
      total: toInt(rows[0]?.[0]),
      months: monthList,
      source: "atendimento_summarized_gold_live",
      filters: { group_name: groupName },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
