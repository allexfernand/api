import { NextRequest, NextResponse } from "next/server";
import { getDocumentCatalog } from "../../../../lib/auditor/document-store";
import { authFromNextRequest } from "../../../../src/server/auth/request-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  try {
    const catalog = await getDocumentCatalog();
    return NextResponse.json(catalog, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (cause) {
    console.error("[auditor-documents] catalog failure", cause);
    return NextResponse.json(
      { error: "Não foi possível carregar as versões dos documentos." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
