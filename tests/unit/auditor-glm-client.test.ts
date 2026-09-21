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
import { loadNivel1Documents } from "../../lib/auditor/knowledge-loader";

describe("auditor GLM response handling", () => {
  afterEach(() => {
    vi.clearAllMocks();
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

  it("uses the fast path for a short confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        finish_reason: "stop",
        message: { content: "Minuta preparada." },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ZAI_API_KEY", "test-key");

    await callAuditor({
      mode: "contrarrefer",
      message: "sim",
      history: [{
        role: "assistant",
        content: "Quer que eu prepare a minuta de contrarreferência?",
      }],
      attachments: [],
    });

    expect(loadNivel1Documents).not.toHaveBeenCalled();
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.max_tokens).toBe(4096);
    expect(request.thinking).toEqual({ type: "disabled" });
    expect(request.tools).toBeUndefined();
  });
});
