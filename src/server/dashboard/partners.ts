// Lista completa dos parceiros (partner_brokers) existentes hoje, sem
// aplicar nenhum recorte — usada só na tela de Configurações para o admin
// poder liberar qualquer parceiro a qualquer usuário, independente do
// próprio recorte do admin logado.
import { getCell, resolveWarehouseId, runQuery } from "../../../lib/databricks";

const ORGANIZATIONS_TABLE = "hive_metastore.sanus_prod.organizations";
const PARTNER_BROKERS_TABLE = "hive_metastore.sanus_prod.partner_brokers";
const ORGANIZATION_PARTNER_BROKERS_TABLE = "hive_metastore.sanus_prod.organization_partner_brokers";

export type PartnerOption = { broker_id: string; broker_name: string };

// Mapa partner_broker_id → nomes dos grupos econômicos (matrizes) ligados a
// ele. Usado na tela de Configurações para, ao marcar um parceiro, já liberar
// automaticamente todos os grupos/empresas daquele parceiro no perfil.
export type PartnerGroupMap = Record<string, string[]>;

export async function listAllPartners(): Promise<PartnerOption[]> {
  const warehouseId = await resolveWarehouseId();
  const rows = await runQuery(warehouseId, `
    WITH partner_orgs AS (
      SELECT CAST(opb.partner_broker_id AS STRING) AS partner_broker_id
      FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      WHERE opb.deleted_at IS NULL
      UNION ALL
      SELECT CAST(opb.partner_broker_id AS STRING) AS partner_broker_id
      FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      INNER JOIN ${ORGANIZATIONS_TABLE} child
        ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
      WHERE opb.deleted_at IS NULL
    )
    SELECT DISTINCT
      CAST(pb.id AS STRING) AS broker_id,
      COALESCE(
        NULLIF(TRIM(CAST(pb.name AS STRING)), ''),
        NULLIF(TRIM(CAST(pb.name_secondary AS STRING)), ''),
        'Sem nome'
      ) AS broker_name
    FROM partner_orgs po
    INNER JOIN ${PARTNER_BROKERS_TABLE} pb
      ON po.partner_broker_id = CAST(pb.id AS STRING)
    WHERE pb.id IS NOT NULL
    ORDER BY broker_name ASC
  `);
  return rows
    .map((r) => ({ broker_id: String(getCell(r[0]) || "").trim(), broker_name: String(getCell(r[1]) || "Sem nome").trim() }))
    .filter((partner) => partner.broker_id);
}

export async function listPartnerGroupMap(): Promise<PartnerGroupMap> {
  const warehouseId = await resolveWarehouseId();
  const rows = await runQuery(warehouseId, `
    WITH partner_orgs AS (
      SELECT
        CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
        CAST(opb.organization_id AS STRING) AS organization_id
      FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      WHERE opb.deleted_at IS NULL
      UNION ALL
      SELECT
        CAST(opb.partner_broker_id AS STRING) AS partner_broker_id,
        CAST(child.id AS STRING) AS organization_id
      FROM ${ORGANIZATION_PARTNER_BROKERS_TABLE} opb
      INNER JOIN ${ORGANIZATIONS_TABLE} child
        ON CAST(child.matriz_id AS STRING) = CAST(opb.organization_id AS STRING)
      WHERE opb.deleted_at IS NULL
    )
    SELECT DISTINCT
      po.partner_broker_id,
      TRIM(COALESCE(matriz.name, o.name)) AS grupo
    FROM partner_orgs po
    INNER JOIN ${ORGANIZATIONS_TABLE} o
      ON CAST(o.id AS STRING) = po.organization_id
    LEFT JOIN ${ORGANIZATIONS_TABLE} matriz
      ON CAST(matriz.id AS STRING) = CAST(o.matriz_id AS STRING)
    WHERE o.active = true
      AND COALESCE(matriz.name, o.name) IS NOT NULL
      AND TRIM(CAST(COALESCE(matriz.name, o.name) AS STRING)) != ''
    ORDER BY partner_broker_id ASC, grupo ASC
  `);

  const map: PartnerGroupMap = {};
  for (const row of rows) {
    const brokerId = String(getCell(row[0]) || "").trim();
    const group = String(getCell(row[1]) || "").trim();
    if (!brokerId || !group) continue;
    if (!map[brokerId]) map[brokerId] = [];
    if (!map[brokerId].includes(group)) map[brokerId].push(group);
  }
  return map;
}
