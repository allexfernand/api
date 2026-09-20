import { z } from "zod";

export const auditorModeSchema = z.enum(["analise", "interno", "parecer", "contrarrefer", "tutor"]);
export type AuditorMode = z.infer<typeof auditorModeSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(40_000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const auditorRequestSchema = z.object({
  mode: auditorModeSchema,
  message: z.string().trim().min(1).max(40_000),
  caseId: z.string().trim().regex(/^[\p{L}\p{N}_-]{1,120}$/u).optional(),
  history: z.array(chatMessageSchema).max(30).default([]),
});
export type AuditorRequestBody = z.infer<typeof auditorRequestSchema>;

export const caseContentSchema = z.object({
  content: z.string().min(1).max(250_000),
});

export const MODE_LABELS: Record<AuditorMode, string> = {
  analise: "Analítico",
  interno: "Parecer interno",
  parecer: "Parecer externo",
  contrarrefer: "Contrarreferência",
  tutor: "Tutor",
};
