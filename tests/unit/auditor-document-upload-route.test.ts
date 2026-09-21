import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  handleUpload: vi.fn(),
}));

vi.mock("../../src/server/auth/request-auth", () => ({
  authFromNextRequest: mocks.auth,
}));
vi.mock("../../lib/auditor/document-store", () => ({
  documentPathname: (category: string, id: string, name: string) =>
    `auditor/knowledge/${category}/${id}/${name}`,
  MAX_DOCUMENT_BYTES: 12 * 1024 * 1024,
}));
vi.mock("@vercel/blob/client", () => ({
  handleUpload: mocks.handleUpload,
}));

import { POST } from "../../app/api/auditor/documents/upload/route";

describe("auditor document upload authorization", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses browser completion as the single manifest registration path", async () => {
    mocks.auth.mockReturnValue({ user: "admin", isAdmin: true });
    mocks.handleUpload.mockImplementation(async (options) => {
      expect(options.onUploadCompleted).toBeUndefined();
      const token = await options.onBeforeGenerateToken(
        "auditor/knowledge/dut/318e7b8c-cdf8-43c7-8fcb-82a881038dfe/anexo.pdf",
        JSON.stringify({
          id: "318e7b8c-cdf8-43c7-8fcb-82a881038dfe",
          category: "dut",
          versionLabel: "RN 667/2026",
          originalName: "anexo.pdf",
        }),
      );
      expect(token).not.toHaveProperty("tokenPayload");
      return { type: "blob.generate-client-token", clientToken: "token" };
    });

    const response = await POST(new NextRequest("http://localhost/api/auditor/documents/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-client-token",
        payload: {
          pathname: "auditor/knowledge/dut/318e7b8c-cdf8-43c7-8fcb-82a881038dfe/anexo.pdf",
        },
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleUpload).toHaveBeenCalledOnce();
  });
});
