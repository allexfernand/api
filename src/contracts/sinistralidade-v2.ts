import { z } from "zod";

export const SINISTRALIDADE_CONTRACT_VERSION = "1.1.0";

export const companyKeySchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const bimesterKeySchema = z.string().regex(/^\d{4}-B[1-6]$/);
export const entityKeySchema = z.string().regex(/^[a-f0-9]{64}$/i);

// Escopos 1.0.0 preservados sem alteração de significado.
export const legacyScopeSchema = z.enum([
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

// Escopos aditivos 1.1.0 (evolução longitudinal).
export const longitudinalScopeSchema = z.enum([
  "timeline",
  "event-mix",
  "top-users-window",
  "user-detail",
  "procedure-trends",
  "hospitalization-trends",
  "provider-trends",
  "concentration",
  "company-benchmark",
  "family-timeline",
  "care-timeline",
  "ps-trends",
]);

export const sinistralidadeScopeSchema = z.enum([
  ...legacyScopeSchema.options,
  ...longitudinalScopeSchema.options,
]);

export const windowMonthsSchema = z.union([
  z.literal(3),
  z.literal(6),
  z.literal(12),
  z.literal(24),
]);

export const rankingBySchema = z.enum(["cost", "services", "hospitalizations", "growth"]);
export const rankingLimitSchema = z.union([z.literal(10), z.literal(20)]);
export const detailLevelSchema = z.enum(["aggregate", "individual"]);

export const sinistralidadeQuerySchema = z.object({
  scope: sinistralidadeScopeSchema.default("metadata"),
  company_key: companyKeySchema.optional(),
  month: monthKeySchema.optional(),
  bimester: bimesterKeySchema.optional(),
  year: z.coerce.number().int().min(2019).max(2100).optional(),
  include_partial: z.enum(["true", "false"]).default("false"),
  // Parâmetros 1.1.0 (aditivos)
  end_month: monthKeySchema.optional(),
  window_months: z.coerce.number().pipe(windowMonthsSchema).optional(),
  ranking_by: rankingBySchema.optional(),
  limit: z.coerce.number().pipe(rankingLimitSchema).optional(),
  entity_key: entityKeySchema.optional(),
  event_type: z.string().max(120).optional(),
  mental_health: z.enum(["true", "false"]).optional(),
  network: z.enum(["rede", "reembolso"]).optional(),
  specialty: z.string().max(120).optional(),
  detail_level: detailLevelSchema.optional(),
});

export const periodStatusSchema = z.enum(["closed", "partial", "unknown"]);

// Estado explícito da resposta: o frontend nunca deduz validade por null.
export const scopeStateSchema = z.enum(["valid", "partial", "blocked", "not_comparable"]);

export const monthStatusEntrySchema = z.object({
  month: monthKeySchema,
  status: periodStatusSchema,
});

export const coverageSchema = z.object({
  person: z.number().nullable(),
  episode: z.number().nullable(),
  family: z.number().nullable(),
  procedure: z.number().nullable(),
  provider: z.number().nullable(),
  cid: z.number().nullable(),
  eligibility: z.enum(["available", "unavailable", "partial"]),
});

// Envelope 1.0.0 preservado.
export const sourceMetadataSchema = z.object({
  contract_version: z.string(),
  generated_at: z.string(),
  company_key: companyKeySchema.optional(),
  period_status: periodStatusSchema,
  warning: z.string().nullable(),
});

// Envelope 1.1.0: obrigatório em todos os escopos longitudinais.
export const longitudinalEnvelopeSchema = z.object({
  contract_version: z.string(),
  generated_at: z.string(),
  company_key: companyKeySchema.optional(),
  scope: longitudinalScopeSchema,
  state: scopeStateSchema,
  requested_period: z.object({
    end_month: monthKeySchema.nullable(),
    window_months: windowMonthsSchema.nullable(),
    include_partial: z.boolean(),
  }),
  effective_period: z.object({
    start_month: monthKeySchema.nullable(),
    end_month: monthKeySchema.nullable(),
    months: z.array(monthStatusEntrySchema),
  }),
  units: z.record(z.string(), z.string()),
  coverage: coverageSchema.nullable(),
  warnings: z.array(z.string()),
  quality_run_id: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type SinistralidadeQuery = z.infer<typeof sinistralidadeQuerySchema>;
export type SinistralidadeScope = z.infer<typeof sinistralidadeScopeSchema>;
export type LongitudinalScope = z.infer<typeof longitudinalScopeSchema>;
export type ScopeState = z.infer<typeof scopeStateSchema>;
export type PeriodStatus = z.infer<typeof periodStatusSchema>;
export type MonthStatusEntry = z.infer<typeof monthStatusEntrySchema>;
export type LongitudinalEnvelope = z.infer<typeof longitudinalEnvelopeSchema>;
export type WindowMonths = z.infer<typeof windowMonthsSchema>;
export type RankingBy = z.infer<typeof rankingBySchema>;
