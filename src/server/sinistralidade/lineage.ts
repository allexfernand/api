// Registro de linhagem da Sinistralidade 360.
// Só agrega: cada entrada é declarada no arquivo da query que ela descreve,
// em src/server/sinistralidade/queries/. Este módulo não conhece SQL nem
// consulta o Databricks.

import { SINISTRALIDADE_CONTRACT_VERSION, type LineageEntry, type LineageRegistry } from "../../contracts/sinistralidade-v2";
import { CONCENTRATION_LINEAGE, BENCHMARK_LINEAGE } from "./queries/concentration";
import { EVENT_MIX_LINEAGE } from "./queries/event-mix";
import { CARE_LINEAGE, FAMILY_LINEAGE, PS_LINEAGE } from "./queries/family-care";
import { HOSPITALIZATION_LINEAGE } from "./queries/hospitalizations";
import { PROCEDURE_LINEAGE } from "./queries/procedures";
import { PROVIDER_LINEAGE } from "./queries/providers";
import { TOP_USERS_LINEAGE, USER_DETAIL_LINEAGE } from "./queries/rankings";
import { TIMELINE_LINEAGE } from "./queries/timeline";
import { KPI_LINEAGE } from "./queries/kpis-lineage";
import { GOLD_PREVIEW_LINEAGE } from "./queries/gold-preview-lineage";

const ENTRIES: LineageEntry[] = [
  ...TIMELINE_LINEAGE,
  ...EVENT_MIX_LINEAGE,
  ...TOP_USERS_LINEAGE,
  ...USER_DETAIL_LINEAGE,
  ...PROCEDURE_LINEAGE,
  ...HOSPITALIZATION_LINEAGE,
  ...PROVIDER_LINEAGE,
  ...CONCENTRATION_LINEAGE,
  ...BENCHMARK_LINEAGE,
  ...FAMILY_LINEAGE,
  ...CARE_LINEAGE,
  ...PS_LINEAGE,
  ...KPI_LINEAGE,
  ...GOLD_PREVIEW_LINEAGE,
];

export function lineageRegistry(): LineageRegistry {
  return {
    contract_version: SINISTRALIDADE_CONTRACT_VERSION,
    generated_at: new Date().toISOString(),
    entries: ENTRIES,
  };
}
