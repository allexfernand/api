import { z } from "zod";
import { ATTENDANT_DEPARTMENTS, attendantDepartmentSchema } from "./attendants";

/** Reutiliza os mesmos setores de Atendentes (Sessões + Qualidade). */
export const QUALITY_CRITERIA_DEPARTMENTS = ATTENDANT_DEPARTMENTS;
export const qualityCriteriaDepartmentSchema = attendantDepartmentSchema;
export type QualityCriteriaDepartment = z.infer<typeof qualityCriteriaDepartmentSchema>;

export const qualityCriterionDepartmentMappingSchema = z.object({
  /** Identificador do subcritério (ex.: "1.2"). */
  criterio_id: z.string().trim().min(1).max(80),
  /** Nome legível do subcritério. */
  sub_criterio: z.string().trim().min(1).max(240),
  /** Um subcritério pode valer para vários departamentos. */
  departments: z.array(qualityCriteriaDepartmentSchema).max(10).default([]),
  updatedAt: z.string().datetime().optional(),
});
export type QualityCriterionDepartmentMapping = z.infer<typeof qualityCriterionDepartmentMappingSchema>;

export const qualityCriterionCandidateSchema = z.object({
  criterio_id: z.string(),
  sub_criterio: z.string(),
  evaluations: z.number().int().nonnegative().optional(),
});
export type QualityCriterionCandidate = z.infer<typeof qualityCriterionCandidateSchema>;

export const qualityCriteriaDepartmentsListResponseSchema = z.object({
  departments: z.array(qualityCriteriaDepartmentSchema),
  candidates: z.array(qualityCriterionCandidateSchema),
  mappings: z.array(qualityCriterionDepartmentMappingSchema),
  candidatesError: z.string().nullable().optional(),
});
export type QualityCriteriaDepartmentsListResponse = z.infer<
  typeof qualityCriteriaDepartmentsListResponseSchema
>;

export const upsertQualityCriterionDepartmentsRequestSchema = z.object({
  criterio_id: z.string().trim().min(1).max(80),
  sub_criterio: z.string().trim().min(1).max(240).optional(),
  departments: z.array(qualityCriteriaDepartmentSchema).max(10),
});
export type UpsertQualityCriterionDepartmentsRequest = z.infer<
  typeof upsertQualityCriterionDepartmentsRequestSchema
>;

export const upsertQualityCriterionDepartmentsResponseSchema = z.object({
  mapping: qualityCriterionDepartmentMappingSchema,
});
