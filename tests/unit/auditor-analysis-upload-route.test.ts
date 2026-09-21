import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  handleUpload: vi.fn(),
  staleCleanup: vi.fn(),
}));

vi.mock("../../src/server/auth/request-auth", () => ({
  authFromNextRequest: mocks.auth,
}));
vi.mock("../../lib/auditor/analysis-attachments", () => ({
  cleanupStaleAnalysisAttachments: mocks.staleCleanup,
  deleteAnalysisAttachments: vi.fn(),
}));
vi.mock("@vercel/blob/client", () => ({
  handleUpload: mocks.handleUpload,
}));

import { POST } from "../../app/api/auditor/attachments/upload/route";

const id = "318e7b8c-cdf8-43c7-8fcb-82a881038dfe";
const pathname = `auditor/analysis-temp/${id}/conta.pdf`;

function tokenRequest() {
  return new NextRequest("http://localhost/api/auditor/attachments/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "blob.generate-client-token",
      payload: { pathname },
    }),
  });
}

describe("auditor analysis upload token", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks users without administration permission", async () => {
    mocks.auth.mockReturnValue({ user: "viewer", isAdmin: false });
    const response = await POST(tokenRequest());
    expect(response.status).toBe(403);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("authorizes a bounded private temporary upload", async () => {
    mocks.auth.mockReturnValue({ user: "admin", isAdmin: true });
    mocks.staleCleanup.mockResolvedValue(undefined);
    mocks.handleUpload.mockImplementation(async (options) => {
      const result = await options.onBeforeGenerateToken(pathname, JSON.stringify({
        id,
        originalName: "conta.pdf",
        size: 1024,
      }));
      expect(result.maximumSizeInBytes).toBe(12 * 1024 * 1024);
      expect(result.allowedContentTypes).toContain("application/pdf");
      expect(options.onUploadCompleted).toBeUndefined();
      return { type: "blob.generate-client-token", clientToken: "token" };
    });

    const response = await POST(tokenRequest());
    expect(response.status).toBe(200);
    expect(mocks.staleCleanup).toHaveBeenCalledOnce();
  });
});
