import { z } from "zod";

export const DOCUMENT_CATEGORIES = [
  { id: "mame", label: "M.A.M.E.", description: "Auditoria hospitalar e intercâmbio Unimed" },
  { id: "maphc", label: "M.A.P.H.C.", description: "Auditoria prospectiva de Home Care" },
  { id: "dut", label: "DUT / Anexo II", description: "Diretrizes de utilização vigentes" },
  { id: "rn566", label: "RN 566/2022", description: "Cobertura e regras do Rol ANS" },
  { id: "tuss-rol", label: "TUSS × Rol", description: "Correlação de códigos e cobertura" },
] as const;

export const documentCategorySchema = z.enum(["mame", "maphc", "dut", "rn566", "tuss-rol"]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

export const documentStatusSchema = z.enum(["active", "archived"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const uploadMetadataSchema = z.object({
  id: z.string().uuid(),
  category: documentCategorySchema,
  versionLabel: z.string().trim().min(1).max(80),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(500).optional(),
  originalName: z.string().trim().min(1).max(180),
  uploadedBy: z.string().trim().min(1).max(120),
});
export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;

export const documentVersionSchema = uploadMetadataSchema.extend({
  pathname: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  uploadedAt: z.string().datetime(),
  status: documentStatusSchema,
  activatedAt: z.string().datetime().optional(),
  activatedBy: z.string().max(120).optional(),
  archivedAt: z.string().datetime().optional(),
  archivedBy: z.string().max(120).optional(),
});
export type AuditorDocumentVersion = z.infer<typeof documentVersionSchema>;

export const documentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  documents: z.array(documentVersionSchema),
});
export type AuditorDocumentManifest = z.infer<typeof documentManifestSchema>;

export const completeUploadSchema = z.object({
  metadata: uploadMetadataSchema.omit({ uploadedBy: true }),
  pathname: z.string().min(1).max(500),
});

export const documentActionSchema = z.object({
  action: z.enum(["activate", "archive"]),
});

export type DocumentCatalogResponse = {
  configured: boolean;
  uploadConfigured: boolean;
  maxActiveBytes: number;
  activeBytes: number;
  documents: AuditorDocumentVersion[];
};

export function safeDocumentFilename(name: string) {
  const extension = name.match(/\.(pdf|xlsx|xls)$/i)?.[0]?.toLowerCase() || "";
  const base = name
    .slice(0, extension ? -extension.length : undefined)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return `${base || "documento"}${extension}`;
}

export function documentPathname(category: DocumentCategory, id: string, originalName: string) {
  return `auditor/knowledge/${category}/${id}/${safeDocumentFilename(originalName)}`;
}

export function categoryLabel(category: DocumentCategory) {
  return DOCUMENT_CATEGORIES.find((item) => item.id === category)?.label || category;
}
