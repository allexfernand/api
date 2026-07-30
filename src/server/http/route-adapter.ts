import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { logger } from "../observability/logger";
import { allowedOrigins } from "../../../lib/http";

type LegacyHandler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function queryObject(request: NextRequest) {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }
  return query;
}

// CORS resolvido de forma central: só ecoamos a origem quando ela está na
// allowlist. Sem allowlist configurada, nenhum Access-Control-Allow-Origin é
// enviado — o dashboard funciona por ser same-origin e origens externas ficam
// bloqueadas pelo navegador.
function applyCors(request: NextRequest, headers: Headers) {
  headers.delete("Access-Control-Allow-Origin");
  const origin = request.headers.get("origin");
  const allowed = allowedOrigins();
  if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else if (!origin && allowed.length === 1) {
    headers.set("Access-Control-Allow-Origin", allowed[0]);
  }
}

export function adaptLegacyRoute(handler: LegacyHandler) {
  return async function route(request: NextRequest) {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    let statusCode = 200;
    let responseBody: unknown = null;
    const headers = new Headers();
    const response = {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      status(code: number) {
        statusCode = code;
        return response;
      },
      json(body: unknown) {
        responseBody = body;
      },
      end() {
        responseBody = null;
      },
    };
    const requestHeaders = Object.fromEntries(request.headers.entries());
    headers.set("x-request-id", requestId);
    try {
      await handler(
        { method: request.method, query: queryObject(request), headers: requestHeaders },
        response,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Erro interno.";
      logger.error("api.unhandled_error", { requestId, path: request.nextUrl.pathname, message });
      statusCode = 500;
      responseBody = { error: { code: "INTERNAL_ERROR", message, requestId } };
    }
    // Nunca vaza detalhe interno (mensagem de SQL/Databricks, stack) para o
    // cliente em erros 5xx. O detalhe fica só no log, correlacionado por
    // requestId; o cliente recebe uma mensagem genérica.
    if (statusCode >= 500) {
      logger.error("api.error_response", {
        requestId,
        path: request.nextUrl.pathname,
        statusCode,
        detail: responseBody,
      });
      responseBody = {
        error: {
          code: "INTERNAL_ERROR",
          message: "Erro interno ao processar a requisição.",
          requestId,
        },
      };
    }
    applyCors(request, headers);
    if (responseBody === null) return new NextResponse(null, { status: statusCode, headers });
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new NextResponse(JSON.stringify(responseBody), { status: statusCode, headers });
  };
}
