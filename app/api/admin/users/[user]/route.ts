import { NextRequest, NextResponse } from "next/server";
import { updateManagedUserRequestSchema } from "../../../../../src/contracts/dashboard-users";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";
import { deleteManagedUser, updateManagedUser } from "../../../../../src/server/auth/managed-users";

type RouteParams = { params: Promise<{ user: string }> };

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  const { user } = await params;
  const parsed = updateManagedUserRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Dados inválidos.", details: parsed.error.flatten() }, { status: 400 });
  try {
    const updated = await updateManagedUser(decodeURIComponent(user), parsed.data);
    return NextResponse.json({ user: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível atualizar o usuário.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  const { user } = await params;
  try {
    await deleteManagedUser(decodeURIComponent(user));
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível remover o usuário.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
