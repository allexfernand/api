// Registro de linhagem da Sinistralidade 360.
// Só agrega: cada entrada é declarada no arquivo da query que ela descreve,
// em src/server/sinistralidade/queries/. Este módulo não conhece SQL nem
// consulta o Databricks.

import { SINISTRALIDADE_CONTRACT_VERSION, type LineageEntry, type LineageRegistry } from "../../contracts/sinistralidade-v2";
import { CONCENTRATION_LINEAGE, BENCHMARK_LINEAGE } from "./queries/concentration";
import { EVENT_MIX_LINEAGE } from "./queries/event-mix";
import { TIMELINE_LINEAGE } from "./queries/timeline";

const ENTRIES: LineageEntry[] = [
  ...TIMELINE_LINEAGE,
  ...EVENT_MIX_LINEAGE,
  ...CONCENTRATION_LINEAGE,
  ...BENCHMARK_LINEAGE,
];

export function lineageRegistry(): LineageRegistry {
  return {
    contract_version: SINISTRALIDADE_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    entries: ENTRIES,
  };
}
