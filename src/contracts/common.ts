import { z } from "zod";

export const dashboardRoleSchema = z.enum(["full", "mds", "custom"]);
export type DashboardRole = z.infer<typeof dashboardRoleSchema>;

export const apiErrorSchema = z.object({
  error: z.union([
    z.string(),
    z.object({
      code: z.string(),
      message: z.string(),
      requestId: z.string().optional(),
      details: z.unknown().optional(),
    }),
  ]),
});

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;

export const dashboardFiltersSchema = z.object({
  groups: z.array(z.string()).default([]),
  company: z.string().optional(),
  beneficiaryType: z.enum(["TITULAR", "DEPENDENTE"]).optional(),
  partnerBrokerId: z.string().optional(),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).default([]),
});

export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;
