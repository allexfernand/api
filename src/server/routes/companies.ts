// api/companies.ts
import {
  MDS_PARTNER_SCOPE,
  requireBasicAuth,
  requireMenuAccess,
  scopedGroupNames,
  scopedPartnerBrokerId,
} from "../../../lib/basic-auth";
import { CORE_DATA_MENUS } from "../../dashboard/menu-catalog";
import { createSqlParams, getCell, resolveWarehouseId, runQuery, type SqlParams } from "../../../lib/databricks";
import { setApiCors } from "../../../lib/http";

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

const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.beneficiaries`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function partnerBrokerCondition(partnerBrokerId: unknown, p: SqlParams) {
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (partnerIds.length) {
    return `CAST(opb.partner_broker_id AS STRING) IN (${p.addAll(partnerIds)})`;
  }
  if (String(partnerBrokerId) === MDS_PARTNER_SCOPE) {
    return `CAST(opb.partner_broker_id AS STRING) IN (
      SELECT CAST(pb.id AS STRING)
      FROM ${PARTNER_BROKERS_TABLE} pb
      WHERE UPPER(TRIM(COALESCE(CAST(pb.name AS STRING), ''))) = 'MDS'
        OR UPPER(TRIM(COALESCE(CAST(pb.name_secondary AS STRING), ''))) = 'MDS'
    )`;
  }
  return `CAST(opb.partner_broker_id AS STRING) = ${p.add(partnerBrokerId)}`;
}

function partnerOrgIdsSubquery(partnerBrokerId: unknown, p: SqlParams) {
  const partnerCondition = partnerBrokerCondition(partnerBrokerId, p);
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

function buildFilters(groupNames: string[], typeFilter: unknown, partnerBrokerId: unknown, p: SqlParams) {
  const conditions = [];
  if (groupNames.length) {
    const groupList = p.addAll(groupNames);
    conditions.push(`b.organization_id IN (
      SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE TRIM(name) IN (${groupList})
      UNION
      SELECT id FROM ${ORGANIZATIONS_TABLE}
      WHERE matriz_id IN (SELECT id FROM ${ORGANIZATIONS_TABLE} WHERE TRIM(name) IN (${groupList}))
    )`);
  }
  if (partnerBrokerId) {
    conditions.push(`CAST(b.organization_id AS STRING) IN ${partnerOrgIdsSubquery(partnerBrokerId, p)}`);
  }
  if (typeFilter === 'TITULAR') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) = 'TITULAR'`);
  } else if (typeFilter === 'DEPENDENTE') {
    conditions.push(`UPPER(TRIM(COALESCE(b.type_kinship,''))) != 'TITULAR'`);
  }
  return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;
  if (!requireMenuAccess(req, res, CORE_DATA_MENUS)) return;

  const groupNames = await scopedGroupNames(req, parseGroupNames(req.query));
  const typeFilter = req.query.type || null;
  const partnerBrokerId = await scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const params = createSqlParams();
  // Mesma base do KPI demográfico (beneficiaries), para a soma por empresa fechar com o total.
  const extraFilter = buildFilters(groupNames, typeFilter, partnerBrokerId, params);

  try {
    const warehouseId = await resolveWarehouseId();

    const rows = await runQuery(warehouseId, `
      SELECT
        COALESCE(NULLIF(TRIM(CAST(o.name AS STRING)), ''), '(sem empresa)') AS empresa,
        COUNT(*) AS total
      FROM ${BENEFICIARIES_TABLE} b
      INNER JOIN ${ORGANIZATIONS_TABLE} o
        ON CAST(b.organization_id AS STRING) = CAST(o.id AS STRING)
      ${extraFilter ? `${extraFilter} AND o.active = true` : 'WHERE o.active = true'}
      GROUP BY COALESCE(NULLIF(TRIM(CAST(o.name AS STRING)), ''), '(sem empresa)')
      ORDER BY total DESC
    `, params.list);

    const companies = rows.map(r => ({
      empresa: getCell(r[0]) ? String(getCell(r[0])).trim() : "(sem empresa)",
      total: parseInt(String(getCell(r[1]))) || 0,
    }));

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      companies,
      total: companies.reduce((acc, item) => acc + item.total, 0),
      source: "beneficiaries+organizations.active",
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
