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
const toDate = (v: DatabricksCell) => { const raw = getCell(v); return raw ? String(raw).slice(0, 10) : ""; };
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function partnerOrgIdsSubquery(partnerBrokerId: unknown) {
  return `(
    SELECT CAST(opb.organization_id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'
      AND opb.deleted_at IS NULL
    UNION
    SELECT CAST(child.id AS STRING)
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'
      AND opb.deleted_at IS NULL
  )`;
}

function buildFilters(groupNames: string[], typeFilter: unknown, partnerBrokerId: unknown) {
  const conditions = [`b.created_at IS NOT NULL`];
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
    conditions.push(`CAST(b.organization_id AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId)}`);
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

  const groupNames = parseGroupNames(req.query);
  const typeFilter = req.query.type || null;
  const partnerBrokerId = req.query.partner_broker_id || null;
  const scope = String(req.query.scope || '').toLowerCase();
  const groupFilter = buildFilters(groupNames, typeFilter, partnerBrokerId);

  try {
    const { warehouses = [] } = await dbFetch("/api/2.0/sql/warehouses") as { warehouses?: Warehouse[] };
    const wh = warehouses.find((w) => w.state === "RUNNING") || warehouses[0];
    if (!wh) throw new Error("Nenhum SQL Warehouse disponível.");

    if (scope === 'partners') {
      const partnerRows = await runQuery(wh.id, `
        WITH partner_orgs AS (
          SELECT
            CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
            CAST(opb.organization_id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          WHERE opb.deleted_at IS NULL
          UNION
          SELECT
            CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
            CAST(child.id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          INNER JOIN ${ORGANIZATIONS_TABLE} child
            ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
          WHERE opb.deleted_at IS NULL
        )
        SELECT
          CAST(pb.id AS STRING) AS broker_id,
          COALESCE(
            NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
            NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
            'Sem nome'
          ) AS broker_name,
          NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), '') AS broker_name_secondary,
          pb.active AS broker_active,
          COUNT(DISTINCT po.organization_id) AS total_orgs
        FROM partner_orgs po
        INNER JOIN ${PARTNER_BROKERS_TABLE} pb
          ON po.partner_broker_id = CAST(pb.id AS STRING)
        WHERE pb.id IS NOT NULL
        GROUP BY
          CAST(pb.id AS STRING),
          COALESCE(
            NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
            NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
            'Sem nome'
          ),
          NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
          pb.active
        ORDER BY broker_name ASC
      `);
      const partners = partnerRows.map((r) => ({
        broker_id: String(getCell(r[0]) || '').trim(),
        broker_name: String(getCell(r[1]) || 'Sem nome').trim(),
        broker_name_secondary: getCell(r[2]) ? String(getCell(r[2])).trim() : '',
        broker_active: String(getCell(r[3])).toLowerCase() === 'true',
        total_orgs: toInt(r[4]),
      })).filter((partner) => partner.broker_id);
      return res.status(200).json({ partners, updatedAt: new Date().toISOString() });
    }

    const [userRows, groupRows, sessionGroupRows] = await Promise.all([
      runQuery(wh.id, `
        SELECT DATE_TRUNC('DAY', b.created_at) AS dia, COUNT(DISTINCT b.id) AS n
        FROM hive_metastore.sanus_prod.beneficiaries b
        ${groupFilter}
        GROUP BY 1 ORDER BY 1
      `),
      !groupNames.length ? runQuery(wh.id, partnerBrokerId ? `
        WITH partner_orgs AS (
          SELECT CAST(opb.organization_id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'
            AND opb.deleted_at IS NULL
          UNION
          SELECT CAST(child.id AS STRING) AS organization_id
          FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
          INNER JOIN ${ORGANIZATIONS_TABLE} child
            ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
          WHERE CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'
            AND opb.deleted_at IS NULL
        )
        SELECT
          COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), '')
          ) AS grupo,
          COUNT(DISTINCT CAST(o.id AS STRING)) AS total_filiais
        FROM partner_orgs po
        INNER JOIN ${ORGANIZATIONS_TABLE} o
          ON CAST(o.id AS STRING) = po.organization_id
        LEFT JOIN ${ORGANIZATIONS_TABLE} parent
          ON CAST(parent.id AS STRING) = CAST(o.matriz_id AS STRING)
        WHERE COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), '')
          ) IS NOT NULL
        GROUP BY
          COALESCE(
            NULLIF(TRIM(CAST(parent.name AS STRING)), ''),
            NULLIF(TRIM(CAST(o.name AS STRING)), '')
          )
        ORDER BY grupo ASC
      ` : `
        SELECT o.name AS grupo, 0 AS total_filiais
        FROM hive_metastore.sanus_prod.organizations o
        WHERE o.active = true
          AND o.name IS NOT NULL
          AND TRIM(CAST(o.name AS STRING)) != ''
          AND (o.is_matriz = true OR o.matriz_id IS NULL)
        ORDER BY o.name ASC
      `) : Promise.resolve(null),
      !groupNames.length ? runQuery(wh.id, `
        SELECT economic_group_canonical AS grupo, COUNT(*) AS total_sessions
        FROM hive_metastore.sanus_prod.dashboard_sessions_base_gold
        WHERE economic_group_canonical IS NOT NULL
          AND TRIM(economic_group_canonical) != ''
        GROUP BY economic_group_canonical
        ORDER BY total_sessions DESC
      `).catch(() => null) : Promise.resolve(null),
    ]);

    const parse = (rows: DatabricksRow[] | null) => (rows || []).map((r) => [toDate(r[0]), toInt(r[1])]);
    const groups = groupRows
      ? groupRows.map((r) => ({
          economic_group: getCell(r[0]) ? String(getCell(r[0])).trim() : null,
          total_orgs: toInt(r[1]),
        })).filter((g) => g.economic_group)
      : null;
    const sessions_groups = sessionGroupRows
      ? sessionGroupRows.map((r) => ({
          economic_group: getCell(r[0]) ? String(getCell(r[0])).trim() : null,
          total_sessions: toInt(r[1]),
        })).filter((g) => g.economic_group)
      : null;

    res.status(200).json({ users: parse(userRows), groups, sessions_groups, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
