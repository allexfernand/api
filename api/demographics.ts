// api/demographics.ts
import { MDS_PARTNER_SCOPE, requireBasicAuth, scopedPartnerBrokerId } from "../lib/basic-auth";
import { escape, getCell, resolveWarehouseId, runQuery, toInt, toNum } from "../lib/databricks";
import { setApiCors, setStableCache } from "../lib/http";

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

const BENEFICIARIES_VIEW = `hive_metastore.sanus_prod.vw_beneficiarios`;
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

function buildFilters(groupNames: string[], company: unknown, typeFilter: unknown, partnerBrokerId: unknown) {
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
      WHERE ${partnerBrokerCondition(partnerBrokerId)}
        AND opb.deleted_at IS NULL
      UNION ALL
      SELECT child.id
      FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      INNER JOIN ${ORGANIZATIONS_TABLE} child
        ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
      WHERE ${partnerBrokerCondition(partnerBrokerId)}
        AND opb.deleted_at IS NULL
    )`);
  }
  if (company) {
    const c = escape(company);
    conditions.push(`CAST(b.organization_id AS STRING) IN (
      SELECT CAST(id AS STRING)
      FROM ${ORGANIZATIONS_TABLE}
      WHERE UPPER(TRIM(CAST(name AS STRING))) = UPPER(TRIM('${c}'))
      UNION
      SELECT CAST(ID_EMPRESA AS STRING)
      FROM ${BENEFICIARIES_VIEW}
      WHERE UPPER(TRIM(CAST(NOME_CLIENTE AS STRING))) = UPPER(TRIM('${c}'))
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
  setApiCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!requireBasicAuth(req, res)) return;

  const groupNames = parseGroupNames(req.query);
  const company = req.query.company || null;
  const typeFilter = req.query.type || null;
  const partnerBrokerId = scopedPartnerBrokerId(req, req.query.partner_broker_id || null);
  const groupFilter = buildFilters(groupNames, company, typeFilter, partnerBrokerId);

  try {
    const warehouseId = await resolveWarehouseId();

    const [totalRows, rows] = await Promise.all([
      runQuery(warehouseId, `
        SELECT COUNT(*) AS total_beneficiarios
        FROM hive_metastore.sanus_prod.beneficiaries b
        ${groupFilter}
      `),
      runQuery(warehouseId, `
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
    setStableCache(res);
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
