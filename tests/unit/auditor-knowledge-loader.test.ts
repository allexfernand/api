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

import { loadNivel1Documents } from "../../lib/auditor/knowledge-loader";

describe("auditor knowledge fallback", () => {
  it("uses the project filesystem when Blob is not configured", async () => {
    const documents = await loadNivel1Documents();
    expect(Array.isArray(documents)).toBe(true);
    expect(mocks.active).not.toHaveBeenCalled();
    expect(mocks.privateDocument).not.toHaveBeenCalled();
  });
});
