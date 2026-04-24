// api/data.js
const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function dbFetch(path, options = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...options,
    headers: { ...HEADERS, ...(options.headers || {}) },
  });
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
    await new Promise((r) => setTimeout(r, 2500));
    data = await dbFetch(`/api/2.0/sql/statements/${sid}`);
    state = data.status.state;
  }
  if (state !== "SUCCEEDED") throw new Error(data.status?.error?.message || "Query falhou: " + state);
  return data.result?.data_array || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const orgId = req.query.org_id || null; // filtro opcional por empresa
  const orgFilter = orgId ? `AND b.organization_id = '${orgId}'` : "";

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const [sessRows, userRows, orgRows] = await Promise.all([
      // Sessões por dia (sem filtro de org por enquanto — tabela botmaker não tem org_id direto)
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', creation_time) AS dia, COUNT(*) AS n
        FROM sanus_databricks.sanus_prod.botmaker_session
        WHERE creation_time IS NOT NULL
        GROUP BY 1 ORDER BY 1
      `),
      // Usuários por dia com filtro opcional de org
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', b.created_at) AS dia, COUNT(DISTINCT b.id) AS n
        FROM sanus_databricks.sanus_prod.beneficiaries b
        WHERE b.created_at IS NOT NULL ${orgFilter}
        GROUP BY 1 ORDER BY 1
      `),
      // Lista de organizações (só na primeira carga, sem filtro de org)
      !orgId ? runQuery(wh.id, `
        SELECT id, name
        FROM sanus_databricks.sanus_prod.organizations
        WHERE id IS NOT NULL AND name IS NOT NULL AND TRIM(name) != ''
        ORDER BY name ASC
      `) : Promise.resolve(null),
    ]);

    const parse = (rows) => (rows || []).map((r) => [r[0].slice(0, 10), parseInt(r[1])]);
    const orgs = orgRows
      ? orgRows.map((r) => ({ id: r[0], name: r[1].trim() }))
      : null;

    res.status(200).json({
      sessions: parse(sessRows),
      users: parse(userRows),
      organizations: orgs,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
