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

// escape simples pra evitar quebra de query com aspas
function escape(s) {
  return String(s).replace(/'/g, "''");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  // Usa name_economic_group quando existir; senão, cai pro name da organização
  const groupExpr = `COALESCE(NULLIF(TRIM(o.name_economic_group), ''), o.name)`;
  const groupFilter = groupName
    ? `INNER JOIN sanus_databricks.sanus_prod.organizations o ON b.organization_id = o.id
       WHERE b.created_at IS NOT NULL AND ${groupExpr} = '${escape(groupName)}'`
    : `WHERE b.created_at IS NOT NULL`;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const [userRows, groupRows] = await Promise.all([
      // Vidas por dia (com filtro opcional de grupo econômico)
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', b.created_at) AS dia, COUNT(DISTINCT b.id) AS n
        FROM sanus_databricks.sanus_prod.beneficiaries b
        ${groupFilter}
        GROUP BY 1 ORDER BY 1
      `),
      // Grupos econômicos — usa name_economic_group quando existir, senão cai pro name
      !groupName ? runQuery(wh.id, `
        SELECT
          COALESCE(NULLIF(TRIM(name_economic_group), ''), name) AS grupo,
          COUNT(*) AS total_orgs
        FROM sanus_databricks.sanus_prod.organizations
        WHERE COALESCE(NULLIF(TRIM(name_economic_group), ''), name) IS NOT NULL
          AND TRIM(COALESCE(NULLIF(TRIM(name_economic_group), ''), name)) != ''
        GROUP BY COALESCE(NULLIF(TRIM(name_economic_group), ''), name)
        ORDER BY grupo ASC
      `) : Promise.resolve(null),
    ]);

    const parse = (rows) => (rows || []).map((r) => [r[0].slice(0, 10), parseInt(r[1])]);
    const groups = groupRows
      ? groupRows.map((r) => ({
          economic_group: r[0] ? String(r[0]).trim() : null,
          total_orgs: parseInt(r[1]) || 0,
        })).filter((g) => g.economic_group)
      : null;

    res.status(200).json({
      users: parse(userRows),
      groups,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
