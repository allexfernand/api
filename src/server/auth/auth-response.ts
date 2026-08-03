import { NextResponse } from "next/server";
import type { EffectiveDashboardAuth } from "../auth/managed-users";
import { prepareTotpChallenge } from "../auth/managed-users";
import {
  createMfaPendingToken,
  createSessionToken,
  expiredMfaPendingCookie,
  mfaPendingCookie,
  sessionCookie,
} from "../auth/session";

function withCookies(body: unknown, cookies: string[]) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return NextResponse.json(body, { headers });
}

export function sessionResponse(auth: EffectiveDashboardAuth) {
  return withCookies(
    { ok: true, role: auth.role, user: auth.user, allowedMenus: auth.allowedMenus, isAdmin: auth.isAdmin },
    [
      sessionCookie(
        createSessionToken(auth.user, auth.role, {
          allowedMenus: auth.allowedMenus,
          isAdmin: auth.isAdmin,
          groupScopes: auth.groupScopes,
          partnerScopes: auth.partnerScopes,
        }),
      ),
      expiredMfaPendingCookie(),
    ],
  );
}

/** Depois da senha (ou troca de senha), decide: sessão, setup 2FA ou código 2FA. */
export async function continueAfterPasswordAuth(auth: EffectiveDashboardAuth) {
  if (auth.mustChangePassword) {
    return NextResponse.json(
      { ok: true, mustChangePassword: true, user: auth.user },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (auth.totpEnabled) {
    const challenge = await prepareTotpChallenge(auth.user);
    const pending = createMfaPendingToken(auth.user, challenge.stage);
    if (challenge.stage === "setup") {
      return withCookies(
        {
          ok: true,
          needsTotpSetup: true,
          user: auth.user,
          totpQrDataUrl: challenge.qrDataUrl,
          totpManualKey: challenge.manualKey,
        },
        [mfaPendingCookie(pending)],
      );
    }
    return withCookies({ ok: true, needsTotp: true, user: auth.user }, [mfaPendingCookie(pending)]);
  }

  return sessionResponse(auth);
}
