import { NextResponse } from "next/server";
import { MFA_PENDING_COOKIE, SESSION_COOKIE } from "../../../../src/server/auth/session";

export function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  const base = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  };
  response.cookies.set(SESSION_COOKIE, "", base);
  response.cookies.set(MFA_PENDING_COOKIE, "", base);
  return response;
}
