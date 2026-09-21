import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  cleanup: vi.fn(),
  call: vi.fn(),
}));

vi.mock("../../src/server/auth/request-auth", () => ({
  authFromNextRequest: mocks.auth,
}));
vi.mock("../../lib/auditor/analysis-attachments", () => ({
  loadAnalysisAttachments: mocks.load,
  deleteAnalysisAttachments: mocks.cleanup,
}));
vi.mock("../../lib/auditor/glm-client", () => ({
  AuditorServiceError: class AuditorServiceError extends Error {
    constructor(
      public status: number,
      public publicMessage: string,
    ) {
      super(publicMessage);
    }
  },
  callAuditor: mocks.call,
}));

import { POST } from "../../app/api/auditor/route";

const attachment = {
  id: "318e7b8c-cdf8-43c7-8fcb-82a881038dfe",
  pathname: "auditor/analysis-temp/318e7b8c-cdf8-43c7-8fcb-82a881038dfe/conta.pdf",
  originalName: "conta.pdf",
  size: 1024,
};

function request(body: object) {
  return new NextRequest("http://localhost/api/auditor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auditor temporary analysis attachments", () => {
  beforeEach(() => {
    mocks.auth.mockReturnValue({ user: "admin", isAdmin: true });
    mocks.cleanup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts an attachment-only analysis and deletes it after success", async () => {
    mocks.load.mockResolvedValue([{ title: "conta.pdf", text: "conteúdo" }]);
    mocks.call.mockResolvedValue({ text: "Análise concluída", model: "glm-5" });

    const response = await POST(request({
      mode: "analise",
      message: "",
      history: [],
      attachments: [attachment],
    }));

    expect(response.status).toBe(200);
    expect(mocks.call).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [attachment] }),
      [{ title: "conta.pdf", text: "conteúdo" }],
    );
    expect(mocks.cleanup).toHaveBeenCalledWith([attachment]);
  });

  it("deletes the attachment and returns a useful validation error when extraction fails", async () => {
    mocks.load.mockRejectedValue(new Error("conta.pdf não possui uma assinatura PDF válida."));

    const response = await POST(request({
      mode: "analise",
      message: "Analise",
      history: [],
      attachments: [attachment],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "conta.pdf não possui uma assinatura PDF válida.",
    });
    expect(mocks.cleanup).toHaveBeenCalledWith([attachment]);
    expect(mocks.call).not.toHaveBeenCalled();
  });
});
