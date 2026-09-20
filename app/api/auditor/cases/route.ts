import { NextRequest, NextResponse } from "next/server";
import { caseStorageInfo, listCases } from "../../../../lib/auditor/knowledge-loader";
import { authFromNextRequest } from "../../../../src/server/auth/request-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  return NextResponse.json(
    { cases: listCases(), storage: caseStorageInfo() },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
