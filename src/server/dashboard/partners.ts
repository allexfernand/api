// Lista completa dos parceiros (partner_brokers) existentes hoje, sem
// aplicar nenhum recorte — usada só na tela de Configurações para o admin
// poder liberar qualquer parceiro a qualquer usuário, independente do
// próprio recorte do admin logado.
import { getCell, resolveWarehouseId, runQuery } from "../../../lib/databricks";

const ORGANIZATIONS_TABLE = "hive_metastore.sanus_prod.organizations";
const PARTNER_BROKERS_TABLE = "hive_metastore.sanus_prod.partner_brokers";
const ORGANIZATION_PARTNER_BROKERS_TABLE = "hive_metastore.sanus_prod.organization_partner_brokers";

export type PartnerOption = { broker_id: string; broker_name: string };

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
