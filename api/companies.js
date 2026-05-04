// api/companies.js
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

const getCell = (cell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};

function buildFilters(groupName, typeFilter) {
  const conditions = [];
  if (groupName) {
    conditions.push(`b.ID_EMPRESA IN (
      SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name = '${escape(groupName)}'
      UNION
      SELECT id FROM hive_metastore.sanus_prod.organizations
      WHERE matriz_id = (SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name = '${escape(groupName)}' LIMIT 1)
    )`);
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

  const groupName = req.query.group_name || null;
  const typeFilter = req.query.type || null;
  const extraFilter = buildFilters(groupName, typeFilter);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const rows = await runQuery(wh.id, `
      SELECT
        NOME_CLIENTE AS empresa,
        COUNT(*) AS total
      FROM sanus_databricks.sanus_prod.vw_beneficiarios b
      WHERE NOME_CLIENTE IS NOT NULL
        ${extraFilter}
      GROUP BY NOME_CLIENTE
      ORDER BY total DESC
    `);

    const companies = rows.map(r => ({
      empresa: getCell(r[0]) ? String(getCell(r[0])).trim() : "—",
      total: parseInt(getCell(r[1])) || 0,
    }));

    res.status(200).json({ companies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
