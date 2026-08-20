import {
  QUALITY_CRITERIA_DEPARTMENTS,
  type QualityCriteriaDepartment,
  type QualityCriterionCandidate,
  type QualityCriterionDepartmentMapping,
  type UpsertQualityCriterionDepartmentsRequest,
} from "../../contracts/quality-criteria-departments";
import { getCell, quoteIdent, resolveWarehouseId, runQuery, toInt } from "../../../lib/databricks";
import {
  readQualityCriterionDepartmentMappings,
  writeQualityCriterionDepartmentMappings,
} from "../config/quality-criteria-department-store";

const EVALUATED_CRITERIA_TABLE = "hive_metastore.sanus_prod.quality_analysis_silver_criteria";

export function normalizeCriterionId(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/,/g, ".");
}

export async function listQualityCriterionDepartmentMappings() {
  return readQualityCriterionDepartmentMappings();
}

export function criterionIdsForDepartment(
  mappings: QualityCriterionDepartmentMapping[],
  department: QualityCriteriaDepartment | string,
): string[] {
  const dept = String(department || "").trim();
  if (!dept) return [];
  return mappings
    .filter((item) => (item.departments || []).includes(dept as QualityCriteriaDepartment))
    .map((item) => String(item.criterio_id || "").trim())
    .filter(Boolean);
}

export async function upsertQualityCriterionDepartments(
  input: UpsertQualityCriterionDepartmentsRequest,
) {
  const current = await readQualityCriterionDepartmentMappings();
  const key = normalizeCriterionId(input.criterio_id);
  const existing = current.find((item) => normalizeCriterionId(item.criterio_id) === key);
  const nextItem: QualityCriterionDepartmentMapping = {
    criterio_id: input.criterio_id.trim(),
    sub_criterio: (input.sub_criterio || existing?.sub_criterio || input.criterio_id).trim(),
    departments: [...new Set(input.departments)],
    updatedAt: new Date().toISOString(),
  };
  const next = current.filter((item) => normalizeCriterionId(item.criterio_id) !== key);
  next.push(nextItem);
  next.sort((a, b) =>
    String(a.criterio_id).localeCompare(String(b.criterio_id), "pt-BR", { numeric: true }),
  );
  await writeQualityCriterionDepartmentMappings(next);
  return nextItem;
}

export async function listQualityCriterionCandidates(): Promise<QualityCriterionCandidate[]> {
  const warehouseId = await resolveWarehouseId();
  const rows = await runQuery(
    warehouseId,
    `
    SELECT
      CAST(q.${quoteIdent("criterio_id")} AS STRING) AS criterio_id,
      COALESCE(NULLIF(TRIM(CAST(q.${quoteIdent("sub_criterio")} AS STRING)), ''), 'Sem subcritério') AS sub_criterio,
      COUNT(*) AS evaluations
    FROM ${EVALUATED_CRITERIA_TABLE} q
    WHERE q.${quoteIdent("criterio_id")} IS NOT NULL
      AND TRIM(CAST(q.${quoteIdent("criterio_id")} AS STRING)) != ''
    GROUP BY
      CAST(q.${quoteIdent("criterio_id")} AS STRING),
      COALESCE(NULLIF(TRIM(CAST(q.${quoteIdent("sub_criterio")} AS STRING)), ''), 'Sem subcritério')
    ORDER BY criterio_id
  `,
  );

  return rows
    .map((row) => ({
      criterio_id: String(getCell(row[0]) || "").trim(),
      sub_criterio: String(getCell(row[1]) || "Sem subcritério").trim(),
      evaluations: toInt(row[2]),
    }))
    .filter((item) => item.criterio_id);
}

export function mergeCandidatesWithMappings(
  candidates: QualityCriterionCandidate[],
  mappings: QualityCriterionDepartmentMapping[],
): QualityCriterionCandidate[] {
  const byId = new Map<string, QualityCriterionCandidate>();
  for (const item of candidates) {
    byId.set(normalizeCriterionId(item.criterio_id), item);
  }
  for (const mapping of mappings) {
    const key = normalizeCriterionId(mapping.criterio_id);
    if (!byId.has(key)) {
      byId.set(key, {
        criterio_id: mapping.criterio_id,
        sub_criterio: mapping.sub_criterio,
        evaluations: 0,
      });
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.criterio_id.localeCompare(b.criterio_id, "pt-BR", { numeric: true }),
  );
}

export { QUALITY_CRITERIA_DEPARTMENTS };
