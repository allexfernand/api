import { NextRequest, NextResponse } from "next/server";
import { MENU_SECTIONS } from "../../../../src/dashboard/menu-catalog";
import { createManagedUserRequestSchema } from "../../../../src/contracts/dashboard-users";
import { authFromNextRequest } from "../../../../src/server/auth/request-auth";
import { createManagedUser, listManagedUsersPublic } from "../../../../src/server/auth/managed-users";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  const users = await listManagedUsersPublic();
  return NextResponse.json(
    { users, menuCatalog: MENU_SECTIONS },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function POST(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  const parsed = createManagedUserRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dados inválidos.", details: parsed.error.flatten() }, { status: 400 });
  try {
    const created = await createManagedUser(parsed.data);
    return NextResponse.json({ user: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível criar o usuário.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
