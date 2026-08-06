import { NextResponse } from "next/server";
import { totpVerifyRequestSchema } from "../../../../../src/contracts/auth";
import { sessionResponse } from "../../../../../src/server/auth/auth-response";
import { completeTotpChallenge } from "../../../../../src/server/auth/managed-users";
import { readMfaPendingCookie } from "../../../../../src/server/auth/session";

export async function POST(request: Request) {
  const pending = readMfaPendingCookie(request.headers.get("cookie") || "");
  if (!pending) {
    return NextResponse.json(
      { error: "Sessão de verificação 2FA expirada. Faça login novamente." },
      { status: 401 },
    );
  }

  const parsed = totpVerifyRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Código inválido.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const auth = await completeTotpChallenge(pending.user, parsed.data.code);
    return sessionResponse(auth, request, "totp");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível validar o autenticador.";
    const status = /inválido|expirado|não está|não encontrado/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
