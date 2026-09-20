import { describe, expect, it } from "vitest";
import {
  activateVersion,
  appendDocumentVersion,
  archiveVersion,
  emptyDocumentManifest,
} from "../../lib/auditor/document-manifest";
import {
  documentPathname,
  safeDocumentFilename,
  uploadMetadataSchema,
  type AuditorDocumentVersion,
} from "../../lib/auditor/document-types";

function version(overrides: Partial<AuditorDocumentVersion> = {}): AuditorDocumentVersion {
  return {
    id: crypto.randomUUID(),
    category: "mame",
    versionLabel: "V.28",
    originalName: "MAME.pdf",
    uploadedBy: "admin",
    pathname: "auditor/knowledge/mame/id/MAME.pdf",
    contentType: "application/pdf",
    size: 1024,
    uploadedAt: "2026-09-20T20:00:00.000Z",
    status: "archived",
    ...overrides,
  };
}

describe("auditor document versions", () => {
  it("creates a safe immutable pathname", () => {
    expect(safeDocumentFilename("M.A.M.E. versão 28.PDF")).toBe("M-A-M-E-versao-28.pdf");
    expect(documentPathname("mame", "123", "../M.A.M.E. versão 28.PDF"))
      .toBe("auditor/knowledge/mame/123/M-A-M-E-versao-28.pdf");
  });

  it("rejects invalid upload metadata", () => {
    const parsed = uploadMetadataSchema.safeParse({
      id: "not-a-uuid",
      category: "other",
      versionLabel: "",
      originalName: "../file.exe",
      uploadedBy: "",
    });
    expect(parsed.success).toBe(false);
  });

  it("activates one version per category and archives the previous version", () => {
    const manifest = emptyDocumentManifest();
    const previous = version({ id: crypto.randomUUID(), status: "active", versionLabel: "V.27" });
    const next = version({ id: crypto.randomUUID(), versionLabel: "V.28" });
    manifest.documents.push(previous, next);

    activateVersion(manifest, next.id, "admin", 20 * 1024 * 1024, "2026-09-20T21:00:00.000Z");

    expect(next.status).toBe("active");
    expect(next.activatedBy).toBe("admin");
    expect(previous.status).toBe("archived");
    expect(previous.archivedAt).toBe("2026-09-20T21:00:00.000Z");
  });

  it("prevents an active set above the request budget", () => {
    const manifest = emptyDocumentManifest();
    manifest.documents.push(
      version({ category: "dut", status: "active", size: 15 }),
      version({ id: crypto.randomUUID(), category: "mame", size: 10 }),
    );
    expect(() => activateVersion(manifest, manifest.documents[1].id, "admin", 20))
      .toThrow("limite total");
  });

  it("keeps uploads idempotent and rejects conflicting identifiers", () => {
    const manifest = emptyDocumentManifest();
    const document = version();
    expect(appendDocumentVersion(manifest, document)).toBe(document);
    expect(appendDocumentVersion(manifest, { ...document })).toBe(document);
    expect(() => appendDocumentVersion(manifest, { ...document, pathname: "other.pdf" }))
      .toThrow("duplicado");
  });

  it("archives an active version without deleting its history", () => {
    const manifest = emptyDocumentManifest();
    const document = version({ status: "active" });
    manifest.documents.push(document);
    archiveVersion(manifest, document.id, "admin", "2026-09-20T22:00:00.000Z");
    expect(document.status).toBe("archived");
    expect(document.archivedBy).toBe("admin");
    expect(manifest.documents).toHaveLength(1);
  });
});
