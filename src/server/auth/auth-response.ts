import { NextResponse } from "next/server";
import type { EffectiveDashboardAuth } from "../auth/managed-users";
import { prepareTotpChallenge } from "../auth/managed-users";
import {
  createMfaPendingToken,
  createSessionToken,
  MFA_PENDING_COOKIE,
  SESSION_COOKIE,
} from "../auth/session";

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MFA_PENDING_TTL_SECONDS = 10 * 60;

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
  };
}

function jsonWithCookies(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function setSessionCookie(response: NextResponse, auth: EffectiveDashboardAuth) {
  const token = createSessionToken(auth.user, auth.role, {
    allowedMenus: auth.allowedMenus,
    isAdmin: auth.isAdmin,
  });
  response.cookies.set(SESSION_COOKIE, token, {
    ...cookieBase(),
    maxAge: SESSION_TTL_SECONDS,
  });
  // Limpa o cookie MFA pendente sem misturar Set-Cookie manualmente
  // (múltiplos Set-Cookie via Headers quebram no Next e a sessão não grava).
  response.cookies.set(MFA_PENDING_COOKIE, "", {
    ...cookieBase(),
    maxAge: 0,
  });
  return response;
}

function setMfaPendingCookie(response: NextResponse, user: string, stage: "setup" | "verify") {
  response.cookies.set(MFA_PENDING_COOKIE, createMfaPendingToken(user, stage), {
    ...cookieBase(),
    maxAge: MFA_PENDING_TTL_SECONDS,
  });
  return response;
}

export function sessionResponse(auth: EffectiveDashboardAuth) {
  return setSessionCookie(
    jsonWithCookies({
      ok: true,
      role: auth.role,
      user: auth.user,
      allowedMenus: auth.allowedMenus,
      isAdmin: auth.isAdmin,
    }),
    auth,
  );
}

/** Depois da senha (ou troca de senha), decide: sessão, setup 2FA ou código 2FA. */
export async function continueAfterPasswordAuth(auth: EffectiveDashboardAuth) {
  if (auth.mustChangePassword) {
    return jsonWithCookies({ ok: true, mustChangePassword: true, user: auth.user });
  }

  if (auth.totpEnabled) {
    const challenge = await prepareTotpChallenge(auth.user);
    if (challenge.stage === "setup") {
      return setMfaPendingCookie(
        jsonWithCookies({
          ok: true,
          needsTotpSetup: true,
          user: auth.user,
          totpQrDataUrl: challenge.qrDataUrl,
          totpManualKey: challenge.manualKey,
        }),
        auth.user,
        "setup",
      );
    }
    return setMfaPendingCookie(
      jsonWithCookies({ ok: true, needsTotp: true, user: auth.user }),
      auth.user,
      "verify",
    );
  }

  return sessionResponse(auth);
}
