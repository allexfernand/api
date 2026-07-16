import { z } from "zod";

export const companyKeySchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const bimesterKeySchema = z.string().regex(/^\d{4}-B[1-6]$/);

export const sinistralidadeScopeSchema = z.enum([
  "metadata",
  "overview",
  "top10",
  "bimester",
  "mental-health",
  "ps-package",
  "care-coordination",
  "family-before-after",
  "year-over-year",
]);

export const sinistralidadeQuerySchema = z.object({
  scope: sinistralidadeScopeSchema.default("metadata"),
  company_key: companyKeySchema.optional(),
  month: monthKeySchema.optional(),
  bimester: bimesterKeySchema.optional(),
  year: z.coerce.number().int().min(2019).max(2100).optional(),
  include_partial: z.enum(["true", "false"]).default("false"),
});

export const sourceMetadataSchema = z.object({
  contract_version: z.string(),
  generated_at: z.string(),
  company_key: companyKeySchema.optional(),
  period_status: z.enum(["closed", "partial", "unknown"]),
  warning: z.string().nullable(),
});

export type SinistralidadeQuery = z.infer<typeof sinistralidadeQuerySchema>;
