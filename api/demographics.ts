// api/demographics.ts
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
function parseGroupNames(query: Record<string, any>) {
  const raw = query.group_names;
  if (raw) {
    try {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) return [...new Set(parsed.map((v) => String(v).trim()).filter(Boolean))];
    } catch {}
  }
  return query.group_name ? [String(query.group_name).trim()].filter(Boolean) : [];
}

const getCell = (cell: DatabricksCell) => {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "object" && cell.string_value !== undefined) return cell.string_value;
  return cell;
};
const toInt = (v: DatabricksCell) => { const n = parseInt(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
const toNum = (v: DatabricksCell) => { const n = parseFloat(String(getCell(v))); return Number.isFinite(n) ? n : 0; };
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function buildFilters(groupNames: string[], typeFilter: unknown, partnerBrokerId: unknown) {
  const conditions = [];
  if (groupNames.length) {
    const groupList = groupNames.map((group) => `'${escape(group)}'`).join(",");
    conditions.push(`b.organization_id IN (
      SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name IN (${groupList})
      UNION
      SELECT id FROM hive_metastore.sanus_prod.organizations
      WHERE matriz_id IN (SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name IN (${groupList}))
    )`);
  }
  if (partnerBrokerId) {
    conditions.push(`b.organization_id IN (
      SELECT opb.organization_id
      FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'
        AND opb.deleted_at IS NULL
    )`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) != 'TITULAR'`);
  }
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const groupNames = parseGroupNames(req.query);
  const typeFilter = req.query.type || null;
  const partnerBrokerId = req.query.partner_broker_id || null;
  const groupFilter = buildFilters(groupNames, typeFilter, partnerBrokerId);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    const [totalRows, rows] = await Promise.all([
      runQuery(wh.id, `
        SELECT COUNT(*) AS total_beneficiarios
        FROM hive_metastore.sanus_prod.beneficiaries b
        ${groupFilter}
      `),
      runQuery(wh.id, `
      SELECT
        COUNT(*)                                                                                               AS total_vidas,
        AVG(CASE WHEN b.birthday IS NOT NULL
            THEN try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) END)                              AS idade_media,
        SUM(CASE WHEN b.birthday IS NOT NULL
            AND try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) < 18 THEN 1 ELSE 0 END)            AS menores_18,
        SUM(CASE WHEN b.birthday IS NOT NULL
            AND try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) > 49 THEN 1 ELSE 0 END)           AS mais_49,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship,''))) = 'TITULAR'    THEN 1 ELSE 0 END)             AS titulares,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.type_kinship,''))) NOT IN ('TITULAR','') THEN 1 ELSE 0 END)      AS dependentes,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender,''))) = 'FEMININO'  THEN 1 ELSE 0 END)                   AS feminino,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender,''))) = 'MASCULINO' THEN 1 ELSE 0 END)                   AS masculino,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender,''))) NOT IN ('FEMININO','MASCULINO') THEN 1 ELSE 0 END)  AS nao_informado,
        SUM(CASE WHEN UPPER(TRIM(COALESCE(b.gender,''))) = 'FEMININO'
            AND b.birthday IS NOT NULL
            AND try_divide(MONTHS_BETWEEN(CURRENT_DATE(), b.birthday), 12) BETWEEN 19 AND 38
            THEN 1 ELSE 0 END)                                                                                AS mulheres_19_38
      FROM hive_metastore.sanus_prod.beneficiaries b
      ${groupFilter}
    `),
    ]);

    const total = totalRows[0] || [];
    const r = rows[0] || [];
    res.status(200).json({
      total_beneficiarios: toInt(total[0]),
      total_vidas:         toInt(r[0]),
      idade_media:         Math.round(toNum(r[1])),
      menores_18:          toInt(r[2]),
      mais_49:             toInt(r[3]),
      titulares:           toInt(r[4]),
      dependentes:         toInt(r[5]),
      feminino:            toInt(r[6]),
      masculino:           toInt(r[7]),
      nao_informado:       toInt(r[8]),
      mulheres_19_38:      toInt(r[9]),
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
