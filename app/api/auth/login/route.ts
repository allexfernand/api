import { NextResponse } from "next/server";
import { loginRequestSchema } from "../../../../src/contracts/auth";
import { continueAfterPasswordAuth } from "../../../../src/server/auth/auth-response";
import { resolveEffectiveAuth } from "../../../../src/server/auth/managed-users";

export async function POST(request: Request) {
  const parsed = loginRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Usuário e senha são obrigatórios." }, { status: 400 });
  const auth = await resolveEffectiveAuth(parsed.data.user, parsed.data.password);
  if (!auth) return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });

  try {
    return await continueAfterPasswordAuth(auth, request);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível concluir o login.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
