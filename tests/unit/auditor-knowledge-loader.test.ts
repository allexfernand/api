import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  privateDocument: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../lib/auditor/document-store", () => ({
  blobStorageConfigured: () => false,
  getActiveDocumentVersions: mocks.active,
  getPrivateDocument: mocks.privateDocument,
}));

import { loadNivel1Documents, parseKnowledgeFile } from "../../lib/auditor/knowledge-loader";

describe("auditor knowledge fallback", () => {
  it("uses the project filesystem when Blob is not configured", async () => {
    const documents = await loadNivel1Documents();
    expect(Array.isArray(documents)).toBe(true);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.privateDocument).not.toHaveBeenCalled();
  });

  it("extracts temporary plain-text documents", async () => {
    await expect(parseKnowledgeFile(
      new TextEncoder().encode("Resumo assistencial para auditoria"),
      "resumo.txt",
    )).resolves.toEqual({
      title: "resumo.txt",
      text: "Resumo assistencial para auditoria",
    });
  });

  it("extracts temporary Markdown documents", async () => {
    await expect(parseKnowledgeFile(
      new TextEncoder().encode("# Caso\n\n- Conduta proposta"),
      "caso.md",
    )).resolves.toEqual({
      title: "caso.md",
      text: "# Caso\n\n- Conduta proposta",
    });
  });
});
