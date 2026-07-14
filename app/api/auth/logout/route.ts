import { NextResponse } from "next/server";
import { expiredSessionCookie } from "../../../../src/server/auth/session";

export function POST() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": expiredSessionCookie(), "Cache-Control": "no-store" } },
  );
}
