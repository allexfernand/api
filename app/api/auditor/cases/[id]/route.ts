import { NextRequest, NextResponse } from "next/server";
import { readCase, writeCase } from "../../../../../lib/auditor/case-store";
import { caseContentSchema } from "../../../../../lib/auditor/types";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const { id } = await params;
  const content = await readCase(id);
  if (content === null) {
    return NextResponse.json({ error: "Caso não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ id, content }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const parsed = caseContentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Conteúdo de caso inválido." }, { status: 400 });
  }

  try {
    const { id } = await params;
    await writeCase(id, parsed.data.content);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível salvar o caso.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
