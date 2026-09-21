import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/auditor/case-store", () => ({
  readCase: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../lib/auditor/knowledge-loader", () => ({
  loadNivel1Documents: vi.fn().mockResolvedValue([]),
  loadSystemPrompt: vi.fn().mockReturnValue("Prompt mestre"),
}));
vi.mock("../../lib/auditor/knowledge-retrieval", () => ({
  selectKnowledgeContext: vi.fn((documents: unknown[]) =>
    documents.length ? "Contexto dos anexos" : ""),
}));

import { callAuditor } from "../../lib/auditor/glm-client";

describe("auditor GLM response handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("disables separate thinking for attachments and accepts Z.AI reasoning fallback", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: {
          content: "",
          reasoning_content: "Parecer consolidado dos documentos.",
        },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ZAI_API_KEY", "test-key");

    const result = await callAuditor({
      mode: "analise",
      message: "",
      history: [],
      attachments: [],
    }, [{ title: "conta.pdf", text: "Dados da conta" }]);

    expect(result.text).toBe("Parecer consolidado dos documentos.");
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.thinking).toEqual({ type: "disabled" });
  });
});
