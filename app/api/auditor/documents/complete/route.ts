import { NextRequest, NextResponse } from "next/server";
import { registerUploadedDocument } from "../../../../../lib/auditor/document-store";
import { completeUploadSchema } from "../../../../../lib/auditor/document-types";
import { authFromNextRequest } from "../../../../../src/server/auth/request-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const parsed = completeUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados de upload inválidos." }, { status: 400 });
  }

  try {
    const document = await registerUploadedDocument(
      { ...parsed.data.metadata, uploadedBy: auth.user },
      parsed.data.pathname,
    );
    return NextResponse.json(
      { document },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Não foi possível registrar o documento.";
    console.error("[auditor-documents] completion failure", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
