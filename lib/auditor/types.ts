import { z } from "zod";

export const MAX_ANALYSIS_ATTACHMENT_BYTES = 12 * 1024 * 1024;
export const MAX_ANALYSIS_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_ANALYSIS_ATTACHMENTS = 8;
export const ANALYSIS_ATTACHMENT_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export const auditorModeSchema = z.enum(["analise", "interno", "parecer", "contrarrefer", "tutor"]);
export type AuditorMode = z.infer<typeof auditorModeSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(40_000),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const analysisAttachmentSchema = z.object({
  id: z.string().uuid(),
  pathname: z.string().trim().min(1).max(500),
  originalName: z.string().trim().min(1).max(180),
  size: z.number().int().positive().max(MAX_ANALYSIS_ATTACHMENT_BYTES),
});
export type AnalysisAttachment = z.infer<typeof analysisAttachmentSchema>;

export const analysisAttachmentUploadSchema = analysisAttachmentSchema.pick({
  id: true,
  originalName: true,
  size: true,
});

export function safeAnalysisAttachmentFilename(name: string) {
  const extension = name.match(/\.(pdf|xlsx|xls|csv|txt|md|docx)$/i)?.[0]?.toLowerCase() || "";
  if (!extension) throw new Error("Formato de anexo não permitido.");
  const base = name
    .slice(0, -extension.length)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return `${base || "documento"}${extension}`;
}

export function analysisAttachmentPathname(id: string, originalName: string) {
  return `auditor/analysis-temp/${id}/${safeAnalysisAttachmentFilename(originalName)}`;
}

export function analysisAttachmentContentType(originalName: string) {
  const extension = originalName.match(/\.[^.]+$/)?.[0]?.toLowerCase() || "";
  const contentTypes: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return contentTypes[extension] || "application/octet-stream";
}

export const auditorRequestSchema = z.object({
  mode: auditorModeSchema,
  message: z.string().trim().max(40_000).default(""),
  caseId: z.string().trim().regex(/^[\p{L}\p{N}_-]{1,120}$/u).optional(),
  history: z.array(chatMessageSchema).max(30).default([]),
  attachments: z.array(analysisAttachmentSchema).max(MAX_ANALYSIS_ATTACHMENTS).default([]),
}).superRefine((value, context) => {
  if (!value.message && value.attachments.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["message"],
      message: "Informe uma mensagem ou anexe ao menos um documento.",
    });
  }
  const totalBytes = value.attachments.reduce((total, attachment) => total + attachment.size, 0);
  if (totalBytes > MAX_ANALYSIS_TOTAL_BYTES) {
    context.addIssue({
      code: "custom",
      path: ["attachments"],
      message: "Os anexos excedem o limite total de 20 MB.",
    });
  }
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
