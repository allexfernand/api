import { NextRequest, NextResponse } from "next/server";
import { authFromNextRequest } from "../../../../src/server/auth/request-auth";
import { readLoginActivity } from "../../../../src/server/config/activity-log-store";

export async function GET(request: NextRequest) {
  const auth = authFromNextRequest(request);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Acesso restrito a administradores." }, { status: 403 });
  }

  const events = await readLoginActivity();
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
