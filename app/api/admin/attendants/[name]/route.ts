import { NextRequest, NextResponse } from "next/server";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";
import { deleteAttendantMapping } from "../../../../../src/server/attendants/service";

type RouteContext = { params: Promise<{ name: string }> };

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const { name: encoded } = await context.params;
  const name = decodeURIComponent(encoded || "").trim();
  if (!name) {
    return NextResponse.json({ error: "Nome do atendente obrigatório." }, { status: 400 });
  }

  try {
    const deleted = await deleteAttendantMapping(name);
    return NextResponse.json({ ok: true as const, name: deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível remover o mapeamento.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
