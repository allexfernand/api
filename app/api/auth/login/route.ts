import { NextResponse } from "next/server";
import { loginRequestSchema } from "../../../../src/contracts/auth";
import { validateDashboardCredentials } from "../../../../src/server/auth/credentials";
import { createSessionToken, sessionCookie } from "../../../../src/server/auth/session";

export async function POST(request: Request) {
  const parsed = loginRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Usuário e senha são obrigatórios." }, { status: 400 });
  const auth = validateDashboardCredentials(parsed.data.user, parsed.data.password);
  if (!auth) return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  return NextResponse.json(
    { ok: true, role: auth.role },
    {
      headers: {
        "Set-Cookie": sessionCookie(createSessionToken(auth.user, auth.role)),
        "Cache-Control": "no-store",
      },
    },
  );
}
