// Ponte entre as rotas App Router (NextRequest) e o helper de sessão legado
// (que espera um objeto simples com `.headers`). Evita duplicar a lógica de
// leitura/validação de cookie/Basic-Auth para as rotas novas de admin.
import type { NextRequest } from "next/server";
import { getDashboardAuth } from "../../../lib/basic-auth";

export function authFromNextRequest(request: NextRequest) {
  return getDashboardAuth({
    headers: {
      cookie: request.headers.get("cookie") || "",
      authorization: request.headers.get("authorization") || "",
    },
  });
}
