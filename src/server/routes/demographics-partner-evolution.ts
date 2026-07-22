import { MDS_PARTNER_SCOPE, requireBasicAuth, scopedPartnerBrokerId } from "../../../lib/basic-auth";
import { escape, getCell, resolveWarehouseId, runQuery, toInt } from "../../../lib/databricks";
import { setApiCors } from "../../../lib/http";

type ApiRequest = { method?: string; query: Record<string, any> };
type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void; end(): void };
};

const BENEFICIARIES_TABLE = `hive_metastore.sanus_prod.beneficiaries`;
const ORGANIZATIONS_TABLE = `hive_metastore.sanus_prod.organizations`;
const PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.partner_brokers`;
const ORGANIZATION_PARTNER_BROKERS_TABLE = `hive_metastore.sanus_prod.organization_partner_brokers`;

function parsePartnerBrokerIds(query: Record<string, any>, fallback: unknown) {
  if (fallback === MDS_PARTNER_SCOPE) return fallback;
  if (query.partner_broker_ids) {
    try {
      const parsed = JSON.parse(String(query.partner_broker_ids));
      if (Array.isArray(parsed)) {
        const partnerIds = [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
        return partnerIds.length ? partnerIds : fallback || null;
      }
    } catch {}
  }
  return fallback ? fallback : null;
}

function partnerBrokerCondition(partnerBrokerId: unknown) {
  const partnerIds = Array.isArray(partnerBrokerId)
    ? partnerBrokerId.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (partnerIds.length) {
    const ids = partnerIds.map((id) => `'${escape(id)}'`).join(",");
    return `CAST(opb.partner_broker_id AS STRING) IN (${ids})`;
  }
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

export default async function handler(req: ApiRequest, res: ApiResponse) {
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;

  const scopedPartnerBroker = scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const partnerBrokerId = parsePartnerBrokerIds(req.query, scopedPartnerBroker);
  const limit = Math.min(Math.max(toInt(req.query.limit) || 8, 1), 12);
  const partnerFilter = partnerBrokerId ? `WHERE ${partnerBrokerCondition(partnerBrokerId)}` : "";
  const selectedPartnersFilter = partnerBrokerId ? "" : `WHERE rp.partner_rank <= ${limit}`;

  try {
    const warehouseId = await resolveWarehouseId();
    const rows = await runQuery(warehouseId, `
      WITH partner_orgs AS (
        SELECT DISTINCT
          CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
          COALESCE(
            NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
            NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
            'Parceiro sem nome'
          ) AS partner_name,
          CAST(opb.organization_id AS STRING) AS organization_id
        FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
        LEFT JOIN ${PARTNER_BROKERS_TABLE} pb
          ON CAST(pb.id AS STRING) = CAST(opb.partner_broker_id AS STRING)
        ${partnerFilter}
        ${partnerFilter ? "AND" : "WHERE"} opb.deleted_at IS NULL
        UNION
        SELECT DISTINCT
          CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
          COALESCE(
            NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
            NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
            'Parceiro sem nome'
          ) AS partner_name,
          CAST(child.id AS STRING) AS organization_id
        FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
        INNER JOIN ${ORGANIZATIONS_TABLE} child
          ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
        LEFT JOIN ${PARTNER_BROKERS_TABLE} pb
          ON CAST(pb.id AS STRING) = CAST(opb.partner_broker_id AS STRING)
        ${partnerFilter}
        ${partnerFilter ? "AND" : "WHERE"} opb.deleted_at IS NULL
      ),
      monthly AS (
        SELECT
          po.partner_broker_id,
          po.partner_name,
          DATE_FORMAT(DATE_TRUNC('MONTH', b.created_at), 'yyyy-MM') AS mes,
          COUNT(DISTINCT b.id) AS total
        FROM ${BENEFICIARIES_TABLE} b
        INNER JOIN partner_orgs po
          ON CAST(b.organization_id AS STRING) = po.organization_id
        WHERE b.created_at IS NOT NULL
        GROUP BY po.partner_broker_id, po.partner_name, DATE_FORMAT(DATE_TRUNC('MONTH', b.created_at), 'yyyy-MM')
      ),
      ranked_partners AS (
        SELECT
          partner_broker_id,
          partner_name,
          SUM(total) AS total_vidas,
          ROW_NUMBER() OVER (ORDER BY SUM(total) DESC, partner_name ASC) AS partner_rank
        FROM monthly
        GROUP BY partner_broker_id, partner_name
      ),
      scoped_monthly AS (
        SELECT m.*, rp.partner_rank
        FROM monthly m
        INNER JOIN ranked_partners rp
          ON rp.partner_broker_id = m.partner_broker_id
        ${selectedPartnersFilter}
      )
      SELECT
        partner_broker_id,
        partner_name,
        mes,
        total,
        SUM(total) OVER (
          PARTITION BY partner_broker_id
          ORDER BY mes ASC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_total
      FROM scoped_monthly
      ORDER BY partner_rank ASC, mes ASC
    `);

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(200).json({
      series: rows.map((row) => ({
        partner_broker_id: String(getCell(row[0]) || ""),
        partner_name: String(getCell(row[1]) || "Parceiro sem nome"),
        mes: String(getCell(row[2]) || ""),
        total: toInt(row[3]),
        cumulative_total: toInt(row[4]),
      })),
      filters: { partner_broker_id: partnerBrokerId },
      top_limit: partnerBrokerId ? null : limit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as { message?: string }).message });
  }
}
