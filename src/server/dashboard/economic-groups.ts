// Lista completa dos grupos econômicos existentes hoje (organizações de
// topo/matriz), sem aplicar nenhum recorte — usada só na tela de
// Configurações para o admin poder liberar qualquer grupo a qualquer
// usuário, independente do próprio recorte do admin logado.
import { getCell, resolveWarehouseId, runQuery } from "../../../lib/databricks";

const ORGANIZATIONS_TABLE = "hive_metastore.sanus_prod.organizations";

export async function listAllEconomicGroups(): Promise<string[]> {
  const warehouseId = await resolveWarehouseId();
  const rows = await runQuery(warehouseId, `
    SELECT DISTINCT TRIM(o.name) AS grupo
    FROM ${ORGANIZATIONS_TABLE} o
    WHERE o.active = true
      AND o.name IS NOT NULL
      AND TRIM(CAST(o.name AS STRING)) != ''
      AND (o.is_matriz = true OR o.matriz_id IS NULL)
    ORDER BY grupo ASC
  `);
  return rows.map((r) => (getCell(r[0]) ? String(getCell(r[0])).trim() : "")).filter(Boolean);
}
