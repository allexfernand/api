import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("../../src/server/auth/request-auth", () => ({
  authFromNextRequest: mocks.auth,
}));
vi.mock("../../lib/auditor/case-store", () => ({
  readCase: mocks.read,
  writeCase: mocks.write,
}));

import { GET, POST } from "../../app/api/auditor/cases/[id]/route";

const context = { params: Promise.resolve({ id: "caso_001" }) };

describe("auditor case permissions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks reading and writing without administration permission", async () => {
    mocks.auth.mockReturnValue({ user: "viewer", isAdmin: false });

    const getResponse = await GET(
      new NextRequest("http://localhost/api/auditor/cases/caso_001"),
      context,
    );
    const postResponse = await POST(
      new NextRequest("http://localhost/api/auditor/cases/caso_001", {
        method: "POST",
        body: JSON.stringify({ content: "# Caso" }),
      }),
      context,
    );

    expect(getResponse.status).toBe(403);
    expect(postResponse.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("persists valid memory content for an administrator", async () => {
    mocks.auth.mockReturnValue({ user: "admin", isAdmin: true });
    mocks.write.mockResolvedValue(undefined);

    const response = await POST(
      new NextRequest("http://localhost/api/auditor/cases/caso_001", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# Caso\nMemória privada" }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith("caso_001", "# Caso\nMemória privada");
  });
});
