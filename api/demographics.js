// api/demographics.js
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
const toInt = (v) => {
  const raw = getCell(v);
  if (raw === null) return 0;
  const n = parseInt(raw);
  return Number.isFinite(n) ? n : 0;
};
const toNum = (v) => {
  const raw = getCell(v);
  if (raw === null) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const groupFilter = groupName
    ? `WHERE b.organization_id IN (
         SELECT id FROM sanus_databricks.sanus_prod.organizations
         WHERE name = '${escape(groupName)}'
         UNION
         SELECT filial.id FROM sanus_databricks.sanus_prod.organizations filial
         INNER JOIN sanus_databricks.sanus_prod.organizations matriz
           ON filial.matriz_id = matriz.id
         WHERE matriz.name = '${escape(groupName)}'
       )`
    : ``;

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses");
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const rows = await runQuery(wh.id, `
      SELECT
        COUNT(*) AS total_vidas,
        AVG(CASE WHEN b.birthday IS NOT NULL THEN try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) END) AS idade_media,
        SUM(CASE WHEN b.birthday IS NOT NULL AND try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) > 49 THEN 1 ELSE 0 END) AS mais_49,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) = 'TITULAR' THEN 1 ELSE 0 END) AS titulares,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship, ''))) NOT IN ('TITULAR', '') THEN 1 ELSE 0 END) AS dependentes,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender, ''))) = 'FEMININO' THEN 1 ELSE 0 END) AS feminino,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender, ''))) = 'MASCULINO' THEN 1 ELSE 0 END) AS masculino,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender, ''))) = 'FEMININO' AND b.birthday IS NOT NULL AND try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) BETWEEN 19 AND 38 THEN 1 ELSE 0 END) AS mulheres_19_38
      FROM sanus_databricks.sanus_prod.beneficiaries b
      ${groupFilter}
    `);

    const r = rows[0] || [];
    res.status(200).json({
      total_vidas: toInt(r[0]),
      idade_media: Math.round(toNum(r[1])),
      mais_49: toInt(r[2]),
      titulares: toInt(r[3]),
      dependentes: toInt(r[4]),
      feminino: toInt(r[5]),
      masculino: toInt(r[6]),
      mulheres_19_38: toInt(r[7]),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
