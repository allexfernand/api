// api/data.js — Vercel Serverless Function
// Estrutura do projeto:
// /
// ├── api/
// │   └── data.js   ← este arquivo
// └── vercel.json   ← opcional, só pra garantir CORS

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;

const HEADERS = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const QUERIES = {
  sessions: `
    SELECT DATE_TRUNC('DAY', creation_time) AS dia, COUNT(*) AS n
    FROM sanus_databricks.sanus_prod.botmaker_session
    WHERE creation_time IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `,
  users: `
    SELECT DATE_TRUNC('DAY', created_at) AS dia, COUNT(DISTINCT id) AS n
    FROM sanus_databricks.sanus_prod.beneficiaries
    WHERE created_at IS NOT NULL
    GROUP BY 1 ORDER BY 1
  `,
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
  return (data.result?.data_array || []).map((r) => [r[0].slice(0, 10), parseInt(r[1])]);
}

export default async function handler(req, res) {
  // CORS — permite qualquer origem (necessário pro artifact acessar)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Descobre o warehouse disponível
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    // Roda as duas queries em paralelo
    const [sessions, users] = await Promise.all([
      runQuery(wh.id, QUERIES.sessions),
      runQuery(wh.id, QUERIES.users),
    ]);

    res.status(200).json({ sessions, users, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
