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
  // Quando uma matriz é selecionada: inclui beneficiários da própria matriz
  // E também de todas suas filiais (organizações cujo matriz_id aponta pra essa matriz)
  const groupFilter = groupName
    ? `WHERE b.created_at IS NOT NULL
       AND b.organization_id IN (
         SELECT id FROM sanus_databricks.sanus_prod.organizations
         WHERE name = '${escape(groupName)}'
         UNION
         SELECT filial.id FROM sanus_databricks.sanus_prod.organizations filial
         INNER JOIN sanus_databricks.sanus_prod.organizations matriz
           ON filial.matriz_id = matriz.id
         WHERE matriz.name = '${escape(groupName)}'
       )`
    : `WHERE b.created_at IS NOT NULL`;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const [userRows, groupRows] = await Promise.all([
      // Vidas por dia (com filtro opcional de matriz)
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', b.created_at) AS dia, COUNT(DISTINCT b.id) AS n
        FROM sanus_databricks.sanus_prod.beneficiaries b
        ${groupFilter}
        GROUP BY 1 ORDER BY 1
      `),
      // Matrizes ativas — organizações cujo id é referenciado como matriz_id por alguma outra
      !groupName ? runQuery(wh.id, `
        SELECT
          o1.name AS grupo,
          COUNT(filiais.id) AS total_filiais
        FROM sanus_databricks.sanus_prod.organizations o1
        LEFT JOIN sanus_databricks.sanus_prod.organizations filiais
          ON filiais.matriz_id = o1.id
        WHERE o1.active = true
          AND o1.name IS NOT NULL
          AND o1.id IN (
            SELECT o2.matriz_id
            FROM sanus_databricks.sanus_prod.organizations o2
            WHERE o2.matriz_id IS NOT NULL
          )
        GROUP BY o1.name
        ORDER BY o1.name ASC
      `) : Promise.resolve(null),
    ]);

    // Extrai valor seja qual for o formato de retorno (string, número, ou objeto Genie-like)
    const getCell = (cell) => {
      if (cell === null || cell === undefined) return null;
      if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
      return cell;
    };
    const toInt = (v) => {
      const raw = getCell(v);
      if (raw === null) return 0;
      const n = parseInt(raw);
      return Number.isFinite(n) ? n : 0;
    };
    const toDate = (v) => {
      const raw = getCell(v);
      return raw ? String(raw).slice(0, 10) : "";
    };

    const parse = (rows) => (rows || []).map((r) => [toDate(r[0]), toInt(r[1])]);
    const groups = groupRows
      ? groupRows.map((r) => ({
          economic_group: getCell(r[0]) ? String(getCell(r[0])).trim() : null,
          total_orgs: toInt(r[1]),
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
