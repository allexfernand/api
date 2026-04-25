// api/appointments.js
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

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v) => { const n = parseInt(getCell(v)); return Number.isFinite(n) ? n : 0; };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const meses     = req.query.meses ? req.query.meses.split(',').filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
  const groupName = req.query.group_name || null;

  const periodoFilter = meses.length > 0
    ? `AND DATE_FORMAT(hora_criacao_atendimento, 'yyyy-MM') IN (${meses.map(m => `'${m}'`).join(',')})`
    : '';

  const groupFilter = groupName
    ? `AND grupo_economico LIKE '%${groupName.replace(/'/g, "''")}'`
    : '';

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const rows = await runQuery(wh.id, `
      SELECT COUNT(*) AS total_tickets
      FROM sanus_databricks.sanus_prod.atendimento_gold_live
      WHERE motivo = 'Concluído com sucesso'
        ${periodoFilter}
        ${groupFilter}
    `);

    res.status(200).json({ total: toInt(rows[0]?.[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
