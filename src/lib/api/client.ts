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
  return options.schema ? options.schema.parse(payload) : (payload as T);
}
