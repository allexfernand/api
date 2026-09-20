import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getDocumentVersion,
  getPrivateDocument,
  safeDocumentFilename,
} from "../../../../../../lib/auditor/document-store";
import { authFromNextRequest } from "../../../../../../src/server/auth/request-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = z.string().uuid().safeParse(rawId);
  if (!id.success) return NextResponse.json({ error: "Versão inválida." }, { status: 400 });

  const document = await getDocumentVersion(id.data);
  if (!document) return NextResponse.json({ error: "Versão não encontrada." }, { status: 404 });

  const result = await getPrivateDocument(document.pathname);
  if (!result || result.statusCode !== 200) {
    return NextResponse.json({ error: "Arquivo não encontrado." }, { status: 404 });
  }

  return new NextResponse(result.stream, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${safeDocumentFilename(document.originalName)}"`,
      "Content-Length": String(result.blob.size),
      "Content-Type": result.blob.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
