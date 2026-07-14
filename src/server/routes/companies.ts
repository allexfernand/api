// api/companies.ts
import { MDS_PARTNER_SCOPE, requireBasicAuth, scopedPartnerBrokerId } from "../../../lib/basic-auth";
import { escape, getCell, resolveWarehouseId, runQuery } from "../../../lib/databricks";
import { setApiCors, setStableCache } from "../../../lib/http";

type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};
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

const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function partnerBrokerCondition(partnerBrokerId: unknown) {
  if (String(partnerBrokerId) === MDS_PARTNER_SCOPE) {
    return `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`;
  }
  return `CAST(opb.partner_broker_id AS STRING) = '${escape(partnerBrokerId)}'`;
}

function partnerOrgIdsSubquery(partnerBrokerId: unknown) {
  const partnerCondition = partnerBrokerCondition(partnerBrokerId);
  return `(
    SELECT CAST(opb.organization_id AS STRING) AS organization_id
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
    UNION ALL
    SELECT CAST(child.id AS STRING) AS organization_id
    FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
    INNER JOIN ${ORGANIZATIONS_TABLE} child
      ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
    WHERE ${partnerCondition}
      AND opb.deleted_at IS NULL
  )`;
}

function buildFilters(groupNames: string[], typeFilter: unknown, partnerBrokerId: unknown) {
  const conditions = [];
  if (groupNames.length) {
    const groupList = groupNames.map((group) => `'${escape(group)}'`).join(",");
    conditions.push(`b.ID_EMPRESA IN (
      SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name IN (${groupList})
      UNION
      SELECT id FROM hive_metastore.sanus_prod.organizations
      WHERE matriz_id IN (SELECT id FROM hive_metastore.sanus_prod.organizations WHERE name IN (${groupList}))
    )`);
  }
  if (partnerBrokerId) {
    conditions.push(`CAST(b.ID_EMPRESA AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId)}`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.GRAU_PARENTESCO,''))) != 'TITULAR'`);
  }
  return conditions.length ? `AND ${conditions.join(' AND ')}` : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;

  const groupNames = parseGroupNames(req.query);
  const typeFilter = req.query.type || null;
  const partnerBrokerId = scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const extraFilter = buildFilters(groupNames, typeFilter, null);
  const partnerCte = partnerBrokerId ? `WITH partner_orgs AS ${partnerOrgIdsSubquery(partnerBrokerId)}` : '';
  const partnerJoin = partnerBrokerId
    ? `INNER JOIN (SELECT DISTINCT organization_id FROM partner_orgs) po
        ON CAST(b.ID_EMPRESA AS STRING) = po.organization_id`
    : '';

  try {
    const warehouseId = await resolveWarehouseId();

    const rows = await runQuery(warehouseId, `
      ${partnerCte}
      SELECT
        NOME_CLIENTE AS empresa,
        COUNT(*) AS total
      FROM hive_metastore.sanus_prod.vw_beneficiarios b
      ${partnerJoin}
      WHERE NOME_CLIENTE IS NOT NULL
        ${extraFilter}
      GROUP BY NOME_CLIENTE
      ORDER BY total DESC
    `);

    const companies = rows.map(r => ({
      empresa: getCell(r[0]) ? String(getCell(r[0])).trim() : "—",
      total: parseInt(String(getCell(r[1]))) || 0,
    }));

    setStableCache(res);
    res.status(200).json({ companies });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
