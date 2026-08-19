import { z } from "zod";

/** Setores oficiais do mapa unificado (Sessões + Qualidade). */
export const ATTENDANT_DEPARTMENTS = ["Enfermagem", "Agendamento", "Tech", "Outros"] as const;

export const attendantDepartmentSchema = z.enum(ATTENDANT_DEPARTMENTS);
export type AttendantDepartment = z.infer<typeof attendantDepartmentSchema>;

export const attendantStatusSchema = z.enum(["Ativo", "Inativo"]);
export type AttendantStatus = z.infer<typeof attendantStatusSchema>;

export const attendantMappingSchema = z.object({
  /** Identificador canônico (normalmente o finished_by bruto). */
  name: z.string().trim().min(1).max(160),
  /** Nome amigável opcional para UI. */
  displayName: z.string().trim().min(1).max(160).optional(),
  department: attendantDepartmentSchema.default("Outros"),
  status: attendantStatusSchema.default("Ativo"),
  aliases: z.array(z.string().trim().min(1).max(160)).max(40).default([]),
  updatedAt: z.string().datetime().optional(),
});
export type AttendantMapping = z.infer<typeof attendantMappingSchema>;

export const attendantCandidateSchema = z.object({
  name: z.string(),
  sessions: z.number().int().nonnegative(),
  lastSeen: z.string().nullable().optional(),
});
export type AttendantCandidate = z.infer<typeof attendantCandidateSchema>;

export const attendantsListResponseSchema = z.object({
  departments: z.array(attendantDepartmentSchema),
  candidates: z.array(attendantCandidateSchema),
  mappings: z.array(attendantMappingSchema),
  candidatesError: z.string().nullable().optional(),
  candidatesMonths: z.number().int().positive().optional(),
});
export type AttendantsListResponse = z.infer<typeof attendantsListResponseSchema>;

export const upsertAttendantMappingRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(160).optional(),
  department: attendantDepartmentSchema,
  status: attendantStatusSchema,
  aliases: z.array(z.string().trim().min(1).max(160)).max(40).optional(),
});
export type UpsertAttendantMappingRequest = z.infer<typeof upsertAttendantMappingRequestSchema>;

export const upsertAttendantMappingResponseSchema = z.object({
  mapping: attendantMappingSchema,
});

export const deleteAttendantMappingResponseSchema = z.object({
  ok: z.literal(true),
  name: z.string(),
});

export const DEFAULT_ATTENDANT_DEPARTMENT: AttendantDepartment = "Outros";
export const DEFAULT_ATTENDANT_STATUS: AttendantStatus = "Ativo";
