import { z } from "zod";

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type RequestOptions<T> = RequestInit & { schema?: z.ZodType<T> };

function formatZodMessage(error: z.ZodError) {
  const first = error.issues[0];
  if (!first) return "Resposta inválida do servidor.";
  // Evita jogar o JSON cru do Zod na UI de login/2FA.
  return first.message || "Resposta inválida do servidor.";
}

export async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : payload?.error?.message || `HTTP ${response.status}`;
    throw new ApiClientError(message, response.status, payload);
  }
  if (!options.schema) return payload as T;
  const parsed = options.schema.safeParse(payload);
  if (parsed.success) return parsed.data;
  throw new ApiClientError(formatZodMessage(parsed.error), 200, payload);
}
