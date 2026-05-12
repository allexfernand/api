// api/data.ts
declare const process: { env: Record<string, string | undefined> };

const HOST  = process.env.DATABRICKS_HOST;
const TOKEN = process.env.DATABRICKS_TOKEN;
const HEADERS = { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" };

type DatabricksCell = null | undefined | string | number | boolean | { string_value?: string };
type DatabricksRow = DatabricksCell[];
type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
type Warehouse = { id: string; state?: string };

async function dbFetch(path: string, options: any = {}) {
  const res = await fetch(`${HOST}${path}`, { ...options, headers: { ...HEADERS, ...(options.headers || {}) } });
  if (!res.ok) throw new Error(`Databricks ${res.status}: ${await res.text()}`);
  return res.json();
}

async function runQuery(warehouseId: string, sql: string): Promise<DatabricksRow[]> {
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

function escape(s: unknown) { return String(s).replace(/'/g, "''"); }

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
const toDate = (v: DatabricksCell) => { const raw = getCell(v); return raw ? String(raw).slice(0, 10) : ""; };

function buildFilters(groupName: unknown, typeFilter: unknown) {
  const conditions = [`b.created_at IS NOT NULL`];
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
  return `WHERE ${conditions.join(' AND ')}`;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupName = req.query.group_name || null;
  const typeFilter = req.query.type || null;
  const groupFilter = buildFilters(groupName, typeFilter);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const [userRows, groupRows] = await Promise.all([
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', b.created_at) AS dia, COUNT(DISTINCT b.id) AS n
        FROM hive_metastore.sanus_prod.beneficiaries b
        ${groupFilter}
        GROUP BY 1 ORDER BY 1
      `),
      !groupName ? runQuery(wh.id, `
        SELECT o1.name AS grupo, COUNT(filiais.id) AS total_filiais
        FROM hive_metastore.sanus_prod.organizations o1
        LEFT JOIN hive_metastore.sanus_prod.organizations filiais ON filiais.matriz_id = o1.id
        WHERE o1.active = true
          AND o1.name IS NOT NULL
          AND o1.id IN (
            SELECT matriz_id FROM hive_metastore.sanus_prod.organizations
            WHERE matriz_id IS NOT NULL
          )
        GROUP BY o1.name
        ORDER BY o1.name ASC
      `) : Promise.resolve(null),
    ]);

    const parse = (rows: DatabricksRow[] | null) => (rows || []).map((r) => [toDate(r[0]), toInt(r[1])]);
    const groups = groupRows
      ? groupRows.map((r) => ({
          economic_group: getCell(r[0]) ? String(getCell(r[0])).trim() : null,
          total_orgs: toInt(r[1]),
        })).filter((g) => g.economic_group)
      : null;

    res.status(200).json({ users: parse(userRows), groups, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
