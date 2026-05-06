// api/agegroups.js
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
    conditions.push(`b.organization_id IN (
      SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name = '${escape(groupName)}'
      UNION
      SELECT id FROM hive_metastore.sanus_prod.organizations
      WHERE matriz_id = (SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name = '${escape(groupName)}' LIMIT 1)
    )`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) != 'TITULAR'`);
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
        CASE
          WHEN idade BETWEEN 0  AND 18 THEN '0-18'
          WHEN idade BETWEEN 19 AND 23 THEN '19-23'
          WHEN idade BETWEEN 24 AND 28 THEN '24-28'
          WHEN idade BETWEEN 29 AND 33 THEN '29-33'
          WHEN idade BETWEEN 34 AND 38 THEN '34-38'
          WHEN idade BETWEEN 39 AND 43 THEN '39-43'
          WHEN idade BETWEEN 44 AND 48 THEN '44-48'
          WHEN idade BETWEEN 49 AND 53 THEN '49-53'
          WHEN idade BETWEEN 54 AND 58 THEN '54-58'
          WHEN idade >= 59              THEN '59+'
          ELSE 'Não informado'
        END AS faixa,
        UPPER(TRIM(COALESCE(b.gender, ''))) AS genero,
        COUNT(*) AS total
      FROM (
        SELECT
          b.gender,
          b.organization_id,
          b.type_kinship,
          FLOOR(try_divide(DATEDIFF(CURRENT_DATE(), CAST(b.birthday AS DATE)), 365.25)) AS idade
        FROM hive_metastore.sanus_prod.beneficiaries b
        WHERE b.birthday IS NOT NULL
        ${extraFilter}
      ) b
      GROUP BY faixa, genero
      ORDER BY
        CASE faixa
          WHEN '0-18'  THEN 1 WHEN '19-23' THEN 2 WHEN '24-28' THEN 3
          WHEN '29-33' THEN 4 WHEN '34-38' THEN 5 WHEN '39-43' THEN 6
          WHEN '44-48' THEN 7 WHEN '49-53' THEN 8 WHEN '54-58' THEN 9
          WHEN '59+'   THEN 10 ELSE 11
        END
    `);

    const faixas = ['0-18','19-23','24-28','29-33','34-38','39-43','44-48','49-53','54-58','59+','Não informado'];
    const result = {};
    faixas.forEach(f => { result[f] = { feminino: 0, masculino: 0, outros: 0 }; });

    rows.forEach(r => {
      const faixa  = String(getCell(r[0]) || 'Não informado');
      const genero = String(getCell(r[1]) || '').toUpperCase();
      const total  = parseInt(getCell(r[2])) || 0;
      if (!result[faixa]) result[faixa] = { feminino: 0, masculino: 0, outros: 0 };
      if (genero === 'FEMININO')       result[faixa].feminino  += total;
      else if (genero === 'MASCULINO') result[faixa].masculino += total;
      else                             result[faixa].outros    += total;
    });

    const agegroups = faixas.map(f => ({
      faixa: f,
      feminino:  result[f]?.feminino  || 0,
      masculino: result[f]?.masculino || 0,
      outros:    result[f]?.outros    || 0,
    })).filter(f => f.feminino + f.masculino + f.outros > 0);

    res.status(200).json({ agegroups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
