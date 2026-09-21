import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  get: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("../../lib/auditor/document-store", () => ({
  blobStorageConfigured: () => mocks.configured,
}));
vi.mock("@vercel/blob", () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  get: mocks.get,
  list: mocks.list,
  put: mocks.put,
}));

import {
  caseStorageInfo,
  listCases,
  readCase,
  writeCase,
} from "../../lib/auditor/case-store";

describe("auditor case storage", () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.configured = true;
  });

  it("lists private Markdown memories from Blob", async () => {
    mocks.list.mockResolvedValue({
      blobs: [
        { pathname: "auditor/cases/caso_002.md" },
        { pathname: "auditor/cases/caso_001.md" },
        { pathname: "auditor/cases/ignorar.txt" },
      ],
      hasMore: false,
    });

    await expect(listCases()).resolves.toEqual(["caso_001", "caso_002"]);
    expect(mocks.list).toHaveBeenCalledWith({
      prefix: "auditor/cases/",
      cursor: undefined,
      limit: 1000,
    });
  });

  it("reads and overwrites a private case memory", async () => {
    mocks.get.mockResolvedValue({ statusCode: 200, stream: "# Caso\nConteúdo" });
    mocks.put.mockResolvedValue({});

    await expect(readCase("caso_001")).resolves.toBe("# Caso\nConteúdo");
    await writeCase("caso_001", "# Caso\nAtualizado");

    expect(mocks.get).toHaveBeenCalledWith("auditor/cases/caso_001.md", {
      access: "private",
      useCache: false,
    });
    expect(mocks.put).toHaveBeenCalledWith(
      "auditor/cases/caso_001.md",
      "# Caso\nAtualizado",
      expect.objectContaining({
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
      }),
    );
  });

  it("reports Blob as persistent storage", () => {
    expect(caseStorageInfo()).toMatchObject({
      writable: true,
      persistent: true,
      provider: "vercel-blob",
    });
  });
});
