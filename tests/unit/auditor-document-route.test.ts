import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  catalog: vi.fn(),
}));

vi.mock("../../src/server/auth/request-auth", () => ({
  authFromNextRequest: mocks.auth,
}));

vi.mock("../../lib/auditor/document-store", () => ({
  getDocumentCatalog: mocks.catalog,
}));

import { GET } from "../../app/api/auditor/documents/route";

describe("auditor documents permissions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks users without administration permission", async () => {
    mocks.auth.mockReturnValue({ user: "viewer", isAdmin: false });
    const response = await GET(new NextRequest("http://localhost/api/auditor/documents"));
    expect(response.status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("returns the private catalog to an administrator without caching", async () => {
    mocks.auth.mockReturnValue({ user: "admin", isAdmin: true });
    mocks.catalog.mockResolvedValue({
      configured: true,
      uploadConfigured: true,
      maxActiveBytes: 20,
      activeBytes: 0,
      documents: [],
    });
    const response = await GET(new NextRequest("http://localhost/api/auditor/documents"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.catalog).toHaveBeenCalledOnce();
  });
});
