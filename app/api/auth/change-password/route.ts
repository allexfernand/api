import { NextResponse } from "next/server";
import { changePasswordRequestSchema } from "../../../../src/contracts/auth";
import { continueAfterPasswordAuth } from "../../../../src/server/auth/auth-response";
import { changePasswordOnLogin } from "../../../../src/server/auth/managed-users";

export async function POST(request: Request) {
  const parsed = changePasswordRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message || "Dados inválidos para troca de senha.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const auth = await changePasswordOnLogin(
      parsed.data.user,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    // Pode ainda precisar configurar/validar 2FA depois da troca.
    return await continueAfterPasswordAuth(auth);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível trocar a senha.";
    const status = /inválidos|não encontrado|não está marcado|não permite/i.test(message) ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
