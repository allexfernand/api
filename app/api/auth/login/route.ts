import { NextResponse } from "next/server";
import { loginRequestSchema } from "../../../../src/contracts/auth";
import { resolveEffectiveAuth } from "../../../../src/server/auth/managed-users";
import { createSessionToken, sessionCookie } from "../../../../src/server/auth/session";

export async function POST(request: Request) {
  const parsed = loginRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Usuário e senha são obrigatórios." }, { status: 400 });
  const auth = await resolveEffectiveAuth(parsed.data.user, parsed.data.password);
  if (!auth) return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  return NextResponse.json(
    { ok: true, role: auth.role, user: auth.user, allowedMenus: auth.allowedMenus, isAdmin: auth.isAdmin },
    {
      headers: {
        "Set-Cookie": sessionCookie(
          createSessionToken(auth.user, auth.role, {
            allowedMenus: auth.allowedMenus,
            isAdmin: auth.isAdmin,
            groupScopes: auth.groupScopes,
            partnerScopes: auth.partnerScopes,
          }),
        ),
        "Cache-Control": "no-store",
      },
    },
  );
}
